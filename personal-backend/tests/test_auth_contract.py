import base64
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from app.core.auth import assert_owns, require_user, require_admin
from app.config import settings


def token(payload, secret=None):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
    data = encode({'alg': 'HS256'}) + '.' + encode(payload)
    signature = hmac.new((secret or settings.secret_key).encode(), data.encode(), hashlib.sha256).digest()
    return data + '.' + base64.urlsafe_b64encode(signature).rstrip(b'=').decode()


class AuthenticationContractTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.get('/owned/{target}')
        def owned(target: str, user=Depends(require_user)):
            assert_owns(user, target)
            return {'ok': True}

        @app.get('/staff')
        def staff(user=Depends(require_admin)):
            return {'ok': True}

        self.client = TestClient(app)
        self.identity = {'sub': '42', 'username': 'isolated-owner', 'role': 'user', 'exp': int(time.time()) + 300}

    def test_authentication_rejects_missing_bad_expired_and_wrong_secret(self):
        with patch.object(settings, 'allow_anonymous_local', False):
            self.assertEqual(self.client.get('/owned/isolated-owner').status_code, 401)
            for value in ('bad', token({**self.identity, 'exp': 1}), token(self.identity, 'wrong-test-secret')):
                self.assertEqual(self.client.get('/owned/isolated-owner', headers={'Authorization': 'Bearer ' + value}).status_code, 401)

    def test_owner_and_role_boundaries(self):
        headers = {'Authorization': 'Bearer ' + token(self.identity)}
        self.assertEqual(self.client.get('/owned/isolated-owner', headers=headers).status_code, 200)
        self.assertEqual(self.client.get('/owned/another-owner', headers=headers).status_code, 403)
        self.assertEqual(self.client.get('/staff', headers=headers).status_code, 403)
        admin = {'Authorization': 'Bearer ' + token({**self.identity, 'role': 'admin'})}
        self.assertEqual(self.client.get('/staff', headers=admin).status_code, 200)
