export type UserRole = 'admin' | 'user';

export interface Account {
  username: string;
  password: string;
  role: UserRole;
}

export interface Session {
  username: string;
  role: UserRole;
}

const ACCOUNTS_KEY = 'psych_prototype_accounts';
const SESSION_KEY_PERSISTENT = 'psych_prototype_session_persistent';
const SESSION_KEY_TEMP = 'psych_prototype_session_temp';

const DEFAULT_ACCOUNTS: Account[] = [
  { username: 'adminer', password: 'admin', role: 'admin' },
  { username: 'xiaoyu', password: '123456', role: 'user' },
];

function readAccounts(): Account[] {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEFAULT_ACCOUNTS));
    return [...DEFAULT_ACCOUNTS];
  }

  try {
    const parsed = JSON.parse(raw) as Account[];
    const hasAdmin = parsed.some((item) => item.username === 'adminer' && item.password === 'admin');
    if (!hasAdmin) {
      const merged = [...parsed, DEFAULT_ACCOUNTS[0]];
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(merged));
      return merged;
    }
    return parsed;
  } catch {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(DEFAULT_ACCOUNTS));
    return [...DEFAULT_ACCOUNTS];
  }
}

function writeAccounts(accounts: Account[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getCurrentSession(): Session | null {
  const raw =
    localStorage.getItem(SESSION_KEY_PERSISTENT) ||
    sessionStorage.getItem(SESSION_KEY_TEMP);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function saveSession(session: Session, remember: boolean) {
  localStorage.removeItem(SESSION_KEY_PERSISTENT);
  sessionStorage.removeItem(SESSION_KEY_TEMP);
  if (remember) {
    localStorage.setItem(SESSION_KEY_PERSISTENT, JSON.stringify(session));
  } else {
    sessionStorage.setItem(SESSION_KEY_TEMP, JSON.stringify(session));
  }
}

export function login(
  username: string,
  password: string,
  remember: boolean
): { ok: boolean; message?: string; role?: UserRole } {
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();
  if (!trimmedUsername || !trimmedPassword) {
    return { ok: false, message: '用户名和密码不能为空' };
  }

  if (trimmedUsername === 'adminer' && trimmedPassword === 'admin') {
    saveSession({ username: trimmedUsername, role: 'admin' }, remember);
    return { ok: true, role: 'admin' };
  }

  const accounts = readAccounts();
  const matched = accounts.find(
    (item) => item.username === trimmedUsername && item.password === trimmedPassword && item.role === 'user'
  );

  if (!matched) {
    return { ok: false, message: '账号或密码错误' };
  }

  saveSession({ username: matched.username, role: 'user' }, remember);
  return { ok: true, role: 'user' };
}

export function register(username: string, password: string): { ok: boolean; message?: string } {
  const trimmedUsername = username.trim();
  const trimmedPassword = password.trim();
  if (!trimmedUsername || !trimmedPassword) {
    return { ok: false, message: '用户名和密码不能为空' };
  }

  const accounts = readAccounts();
  const exists = accounts.some((item) => item.username === trimmedUsername);
  if (exists) {
    return { ok: false, message: '用户名已存在' };
  }

  accounts.push({ username: trimmedUsername, password: trimmedPassword, role: 'user' });
  writeAccounts(accounts);
  return { ok: true };
}

export function logout() {
  localStorage.removeItem(SESSION_KEY_PERSISTENT);
  sessionStorage.removeItem(SESSION_KEY_TEMP);
}
