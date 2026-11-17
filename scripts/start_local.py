"""Start isolated local services for this checkout (Python stdlib bootstrap)."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / '.local-run'
KEY = hashlib.sha256(str(ROOT).lower().encode()).hexdigest()[:10]
BASE = 20000 + (int(KEY, 16) % 2000) * 10
CONTAINER = f'personal-kg-{KEY}'
STATE = RUN / 'services.json'
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def log(message):
    print(message, flush=True)


def command(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True,
                          creationflags=HIDDEN, **kwargs)


def read_env(path):
    result = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def save(state):
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=2), encoding='utf-8')
    temporary.replace(STATE)


def fetch(port, path):
    with HTTP.open(f'http://127.0.0.1:{port}{path}', timeout=3) as response:
        return json.load(response)


def owned(service, info):
    try:
        identity = fetch(info['port'], '/__dev_instance')
        return (identity.get('root', '').lower() == str(ROOT).lower()
                and identity.get('service') == service
                and identity.get('token') == info['token'])
    except (OSError, ValueError, KeyError):
        return False


def free_port(preferred):
    for port in range(preferred, preferred + 1000):
        try:
            # An IPv6 listener can also own the IPv4 port on Windows.
            with socket.socket() as sock:
                if os.name == 'nt':
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                sock.bind(('127.0.0.1', port))
            return port
        except OSError:
            pass
    raise RuntimeError('No available local service port')


def stop_service(service, info):
    if not owned(service, info):
        log(f'[skip] {service}: not a verified process of this checkout')
        return
    # In addition to the HTTP nonce, check the saved PID's command line before killing.
    query = f'(Get-CimInstance Win32_Process -Filter "ProcessId = {int(info["pid"])}").CommandLine'
    line = command(['powershell.exe', '-NoProfile', '-Command', query],
                   capture_output=True, text=True).stdout.lower()
    expected = ROOT / ('frontend/node_modules/vite/bin/vite.js' if service == 'frontend'
                       else 'scripts/dev_service.py')
    if str(expected).lower() not in line:
        raise RuntimeError(f'{service}: PID ownership changed; refusing to stop it')
    command(['taskkill', '/PID', info['pid'], '/T', '/F'], capture_output=True)
    log(f'[stop] {service} :{info["port"]}')


def start_service(service, executable, arguments, directory, env, state, preferred):
    files = [directory / '.env', directory / '.env.local', ROOT / 'scripts/dev_service.py']
    if service in ('backend', 'agent'):
        files.extend(sorted((directory / 'app').rglob('*.py')))
    configuration = hashlib.sha256(json.dumps(env, sort_keys=True).encode()
                                   + b''.join(p.read_bytes() for p in files if p.exists())).hexdigest()
    previous = state.get(service, {})
    if owned(service, previous):
        if previous.get('configuration') == configuration:
            log(f'[reuse] {service} :{previous["port"]} (verified checkout)')
            return previous['port']
        stop_service(service, previous)
    port = free_port(previous.get('port', preferred))
    token = secrets.token_hex(24)
    child_env = dict(os.environ, **env, LOCAL_DEV_TOKEN=token,
                     LOCAL_DEV_ROOT=str(ROOT), PYTHONUTF8='1', PYTHONUNBUFFERED='1')
    logfile = RUN / f'{service}.log'
    with logfile.open('ab') as output:
        process = subprocess.Popen([str(executable), *[str(a) for a in arguments(port)]],
                                   cwd=directory, env=child_env, stdout=output,
                                   stderr=subprocess.STDOUT, creationflags=HIDDEN)
    info = {'port': port, 'pid': process.pid, 'token': token, 'configuration': configuration}
    state[service] = info
    save(state)
    for _ in range(180):
        if owned(service, info):
            log(f'[ready] {service} :{port}')
            return port
        if process.poll() is not None:
            raise RuntimeError(f'{service} exited ({process.returncode}); see {logfile}')
        time.sleep(1)
    raise RuntimeError(f'{service} startup timed out; see {logfile}')


def ensure_python(directory, imports, requirements):
    executable = directory / 'venv/Scripts/python.exe'
    def probe(code):
        try:
            return command([executable, '-c', code], capture_output=True).returncode == 0
        except (OSError, subprocess.CalledProcessError):
            return False
    if not probe('import sys'):
        command([sys.executable, '-m', 'venv', directory / 'venv'])
    if not probe(imports):
        log(f'[setup] Installing dependencies in {directory.name}/venv ...')
        pip = [executable, '-m', 'pip', 'install', '--retries', '3', '--timeout', '30',
               '--index-url', 'https://pypi.org/simple']
        for attempt in range(2):
            try:
                command([*pip, *requirements])
                break
            except subprocess.CalledProcessError:
                if attempt:
                    raise RuntimeError(f'Dependency installation failed: {directory}; retry with your proxy enabled')
                log('[retry] Dependency download failed; retrying ...')
        if not probe(imports):
            raise RuntimeError(f'Dependency verification failed: {directory}')
    return executable


def docker(*args):
    return command(['docker', *args], capture_output=True, text=True, encoding='utf-8')


def ensure_docker():
    if not shutil.which('docker'):
        raise RuntimeError('Docker CLI is missing; install Docker Desktop first')
    def ready():
        try:
            docker('info', '--format', '{{.ServerVersion}}')
            return True
        except subprocess.CalledProcessError:
            return False
    if ready():
        return
    candidates = [Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Docker/Docker/Docker Desktop.exe',
                  Path(os.environ['LOCALAPPDATA']) / 'Programs/DockerDesktop/Docker Desktop.exe']
    desktop = next((p for p in candidates if p.exists()), None)
    if not desktop:
        raise RuntimeError('Docker daemon is not running; start Docker Desktop')
    log('[wait] Starting Docker Desktop ...')
    subprocess.Popen([str(desktop)], creationflags=HIDDEN)
    for _ in range(60):
        if ready():
            return
        time.sleep(3)
    raise RuntimeError('Docker Desktop was not ready within 3 minutes; check its WSL status')


def ensure_graph(state):
    ensure_docker()
    try:
        info = json.loads(docker('inspect', CONTAINER).stdout)[0]
    except subprocess.CalledProcessError:
        info = None
    if info:
        if info['Config'].get('Labels', {}).get('local.checkout') != str(ROOT):
            raise RuntimeError('Neo4j container belongs to another checkout')
        mappings = info['HostConfig']['PortBindings']
        bolt = int(mappings['7687/tcp'][0]['HostPort'])
        browser = int(mappings['7474/tcp'][0]['HostPort'])
        password = state.get('graph', {}).get('password')
        if not password:
            # Recover credentials only from this checkout's labeled container.
            auth = next(v for v in info['Config']['Env'] if v.startswith('NEO4J_AUTH='))
            password = auth.split('/', 1)[1]
        if not info['State']['Running']:
            docker('start', CONTAINER)
    else:
        bolt = free_port(BASE + 3)
        browser = free_port(max(BASE + 4, bolt + 1))
        password = secrets.token_urlsafe(24)
        log(f'[setup] Creating isolated Neo4j: {CONTAINER}')
        # Reuse the installed Neo4j 5 image if available; no change to main's container.
        images = [json.loads(line) for line in docker('image', 'ls', '--format', 'json').stdout.splitlines() if line.strip()]
        image = next((f'{v["Repository"]}:{v["Tag"]}' for v in images
                      if v['Repository'] == 'neo4j' and v['Tag'].startswith('5')), 'neo4j:5-community')
        docker('run', '-d', '--name', CONTAINER, '--label', f'local.checkout={ROOT}',
               '-p', f'127.0.0.1:{bolt}:7687', '-p', f'127.0.0.1:{browser}:7474',
               '-e', f'NEO4J_AUTH=neo4j/{password}', '-v', f'{CONTAINER}-data:/data', image)
    state['graph'] = {'bolt': bolt, 'browser': browser, 'password': password, 'container': CONTAINER}
    save(state)
    return {'NEO4J_URI': f'bolt://127.0.0.1:{bolt}', 'NEO4J_USER': 'neo4j', 'NEO4J_PASSWORD': password}


def seed_graph(python, environment):
    env = dict(os.environ, **environment, PYTHONUTF8='1')
    probe = '''from app.core.neo4j import get_driver
d = get_driver()
d.verify_connectivity()
with d.session() as s:
    print(s.run("MATCH (n) RETURN count(n) AS c").single()["c"])
d.close()
'''
    log('[wait] Verifying isolated Neo4j authentication ...')
    for _ in range(90):
        try:
            result = command([python, '-c', probe], cwd=ROOT / 'personal-backend', env=env,
                             capture_output=True, text=True, timeout=8)
            count = int(result.stdout.strip())
            break
        except (subprocess.SubprocessError, ValueError):
            time.sleep(2)
    else:
        raise RuntimeError('Neo4j authentication failed; all services have NOT been started successfully')
    # Constraints are idempotent; always reapply. Seed only this isolated graph.
    for script in ['init_kg.py', *(['seed_domain_kg.py'] if count == 0 else [])]:
        with (RUN / 'graph-init.log').open('ab') as output:
            command([python, ROOT / 'personal-backend/scripts' / script],
                    cwd=ROOT / 'personal-backend', env=env, stdout=output, stderr=subprocess.STDOUT)


def validate_database(directory, default):
    url = read_env(directory / '.env').get('DATABASE_URL', default)
    if not url.startswith('sqlite:///'):
        raise RuntimeError(f'{directory.name}: use an independent local SQLite database for isolated development')
    path = Path(url.removeprefix('sqlite:///'))
    resolved = (directory / path).resolve()
    if not resolved.is_relative_to(ROOT):
        raise RuntimeError(f'{directory.name}: DATABASE_URL points outside this checkout; refusing to share main data')
    return url


def run(args):
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if args.status:
        for service in ['backend', 'agent', 'frontend']:
            info = state.get(service, {})
            log(f'{service}: {"ready" if owned(service, info) else "stopped/unverified"} :{info.get("port", "-")}')
        return
    if args.stop:
        for service in ['frontend', 'agent', 'backend']:
            if service in state:
                stop_service(service, state[service])
        if state.get('graph'):
            # Inspect label before touching a container, even if state was edited.
            info = json.loads(docker('inspect', CONTAINER).stdout)[0]
            if info['Config'].get('Labels', {}).get('local.checkout') == str(ROOT):
                docker('stop', CONTAINER)
                log(f'[stop] {CONTAINER}; database volume retained')
        return
    log(f'Checkout: {ROOT}\nService logs: {RUN}')
    back_database = validate_database(ROOT / 'backend', 'sqlite:///./data/dev.db')
    agent_database = validate_database(ROOT / 'personal-backend', 'sqlite:///./mental_screening.db')
    secret = read_env(ROOT / 'backend/.env').get('SECRET_KEY') or 'your-secret-key-change-in-production'
    backend = ensure_python(ROOT / 'backend', 'import numpy, PIL', ['numpy>=2.0', 'pillow>=10.0'])
    graph_env = {'DATABASE_URL': agent_database, 'SECRET_KEY': secret, 'STEWARD_RECOVER_LEASES': '1'}
    # A private credential per checkout; never sent to the browser or shared with main.
    sync_secret = state.setdefault('steward_sync_secret', secrets.token_urlsafe(32))
    graph_env['STEWARD_SYNC_SECRET'] = sync_secret
    agent = None
    if not args.skip_agent:
        agent_dir = ROOT / 'personal-backend'
        envfile = agent_dir / '.env'
        if not envfile.exists():
            text = (agent_dir / '.env.example').read_text(encoding='utf-8-sig')
            envfile.write_text(text.replace('ENABLE_MOCK_ENGINES=False', 'ENABLE_MOCK_ENGINES=True'), encoding='utf-8')
        agent = ensure_python(agent_dir, 'import fastapi, uvicorn, neo4j, sqlalchemy, pydantic_settings, httpx',
                              ['-r', agent_dir / 'requirements.txt'])
        graph_env.update(ensure_graph(state))
        seed_graph(agent, graph_env)
    runner = ROOT / 'scripts/dev_service.py'
    back_env = {'DATABASE_URL': back_database, 'SECRET_KEY': secret, 'STEWARD_SYNC_SECRET': sync_secret,
                'STEWARD_AGENT_URL': f'http://127.0.0.1:{state.get("agent", {}).get("port", BASE + 1)}'}
    back_port = start_service('backend', backend, lambda p: [runner, '--service', 'backend', '--port', p],
                              ROOT / 'backend', back_env, state, BASE)
    agent_port = None
    if agent:
        graph_env['STEWARD_BACKEND_URL'] = f'http://127.0.0.1:{back_port}'
        agent_port = start_service('agent', agent, lambda p: [runner, '--service', 'agent', '--port', p],
                                   ROOT / 'personal-backend', graph_env, state, BASE + 1)
        if back_env['STEWARD_AGENT_URL'] != f'http://127.0.0.1:{agent_port}':
            back_env['STEWARD_AGENT_URL'] = f'http://127.0.0.1:{agent_port}'
            next_port = start_service('backend', backend, lambda p: [runner, '--service', 'backend', '--port', p],
                                      ROOT / 'backend', back_env, state, back_port)
            if next_port != back_port:
                raise RuntimeError('Backend port changed during service linking; restart the launcher to relink safely')
        health = fetch(agent_port, '/api/v1/health')
        if not health.get('neo4j_connected'):
            raise RuntimeError('Agent is running but Neo4j health failed')
        if health.get('mock_mode') and not args.allow_mock:
            raise RuntimeError('Agent is in Mock mode. Configure LLM_API_KEY and ENABLE_MOCK_ENGINES=False in personal-backend/.env. For intentional offline development, use -AllowMock.')
    vite = ROOT / 'frontend/node_modules/vite/bin/vite.js'
    if not vite.exists():
        command([shutil.which('npm.cmd') or 'npm.cmd', 'ci'], cwd=ROOT / 'frontend')
    front_env = {'VITE_DEV_PROXY_TARGET': f'http://127.0.0.1:{back_port}',
                 'VITE_PERSONAL_PROXY_TARGET': f'http://127.0.0.1:{agent_port}' if agent_port else 'http://127.0.0.1:1',
                 'VITE_USE_MOCK': 'false', 'VITE_STRICT_BACKEND': '1',
                 'VITE_API_BASE_URL': '', 'VITE_API_BASE': '', 'VITE_PERSONAL_API_BASE': '', 'VITE_BASE_PATH': '/'}
    front_port = start_service('frontend', shutil.which('node') or 'node',
                               lambda p: [vite, '--host', '127.0.0.1', '--port', p, '--strictPort'],
                               ROOT / 'frontend', front_env, state, BASE + 2)
    if fetch(back_port, '/health').get('status') != 'healthy':
        raise RuntimeError('Backend health check failed')
    # Exercise both API proxy routes, rather than trusting a listening port.
    proxy_identity = fetch(front_port, '/api/__dev_instance')
    if proxy_identity.get('token') != state['backend']['token']:
        raise RuntimeError('Frontend proxy points to a different backend')
    if agent_port:
        if not fetch(front_port, '/api/v1/health').get('neo4j_connected'):
            raise RuntimeError('Frontend-to-agent proxy health failed')
    log(f'\n[OK] {"Full stack" if agent else "Core stack (-SkipAgent)"} ready for this checkout')
    log(f'Frontend: http://127.0.0.1:{front_port}\nBackend: http://127.0.0.1:{back_port}')
    if agent_port:
        log(f'Agent: http://127.0.0.1:{agent_port}/docs\nNeo4j: http://127.0.0.1:{state["graph"]["browser"]}')
        log(f'Model mode: {"MOCK (explicitly allowed)" if health.get("mock_mode") else "REAL (configured; upstream availability depends on provider)"}')
    if not args.no_browser:
        webbrowser.open(f'http://127.0.0.1:{front_port}')


@contextmanager
def launcher_lock():
    import msvcrt
    RUN.mkdir(exist_ok=True)
    with (RUN / 'launcher.lock').open('a+b') as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise RuntimeError('This checkout already has a launcher running; wait for it to finish')
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--skip-agent', action='store_true')
    parser.add_argument('--allow-mock', action='store_true')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--stop', action='store_true')
    modes.add_argument('--status', action='store_true')
    arguments = parser.parse_args()
    try:
        with launcher_lock():
            run(arguments)
    except Exception as error:
        # Never print subprocess arguments: they can contain local Neo4j credentials.
        message = f'Command failed (exit {error.returncode}); see local service logs' if isinstance(error, subprocess.CalledProcessError) else str(error)
        log(f'[FAIL] {message}')
        sys.exit(1)
