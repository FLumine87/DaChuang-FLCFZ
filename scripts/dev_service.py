"""Checkout-scoped entry points used only by the Windows development launcher."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--service', choices=['backend', 'agent'], required=True)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    directory = root / ('backend' if args.service == 'backend' else 'personal-backend')
    os.chdir(directory)
    sys.path.insert(0, str(directory))
    identity = {'root': str(root), 'service': args.service,
                'token': os.environ['LOCAL_DEV_TOKEN']}
    if args.service == 'backend':
        from app.config import settings
        settings.DATABASE_URL = os.environ['DATABASE_URL']
        settings.SECRET_KEY = os.environ['SECRET_KEY']
        from app.server import ApiHandler, run_server
        original = ApiHandler.do_GET

        def get(handler):
            if handler.path in ('/__dev_instance', '/api/__dev_instance'):
                body = json.dumps(identity).encode()
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(body)))
                handler.end_headers()
                handler.wfile.write(body)
            else:
                original(handler)

        ApiHandler.do_GET = get
        run_server(host='127.0.0.1', port=args.port)
    else:
        import uvicorn
        from app.main import app

        @app.get('/__dev_instance', include_in_schema=False)
        def dev_instance():
            return identity

        uvicorn.run(app, host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
