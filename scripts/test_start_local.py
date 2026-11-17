"""Regression checks for checkout isolation; run: python scripts/test_start_local.py."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import start_local as launcher


class IsolationTests(unittest.TestCase):
    def test_never_reuse_other_checkout_or_old_nonce(self):
        info = {'port': 8000, 'token': 'this-run'}
        own = {'root': str(launcher.ROOT), 'service': 'backend', 'token': 'this-run'}
        with patch.object(launcher, 'fetch', return_value=own):
            self.assertTrue(launcher.owned('backend', info))
        for different in [dict(own, root='D:/other-checkout'), dict(own, token='old'), dict(own, service='agent')]:
            with patch.object(launcher, 'fetch', return_value=different):
                self.assertFalse(launcher.owned('backend', info))

    def test_port_conflict_uses_another_port(self):
        import socket
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            port = occupied.getsockname()[1]
            occupied.listen()
            self.assertGreater(launcher.free_port(port), port)

    def test_stop_does_not_touch_foreign_process(self):
        with patch.object(launcher, 'owned', return_value=False), patch.object(launcher, 'command') as command:
            launcher.stop_service('backend', {'pid': 123, 'port': 8000})
            command.assert_not_called()

    def test_reuse_requires_matching_configuration(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            files = [directory / '.env', directory / '.env.local', launcher.ROOT / 'scripts/dev_service.py']
            digest = hashlib.sha256(b'{}' + b''.join(p.read_bytes() for p in files if p.exists())).hexdigest()
            state = {'backend': {'port': 30000, 'configuration': digest}}
            with patch.object(launcher, 'owned', return_value=True), patch.object(launcher.subprocess, 'Popen') as popen:
                self.assertEqual(launcher.start_service('backend', 'python', None, directory, {}, state, 30000), 30000)
                popen.assert_not_called()

    def test_external_database_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / '.env').write_text('DATABASE_URL=sqlite:///D:/another-project/data.db')
            with self.assertRaisesRegex(RuntimeError, 'outside this checkout'):
                launcher.validate_database(directory, '')

    def test_state_recovers_unicode_paths(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(launcher, 'STATE', Path(folder) / 'services.json'):
            launcher.save({'root': 'D:/项目 空格', 'backend': {'port': 30000}})
            self.assertEqual(json.loads(launcher.STATE.read_text())['root'], 'D:/项目 空格')


if __name__ == '__main__':
    unittest.main()
