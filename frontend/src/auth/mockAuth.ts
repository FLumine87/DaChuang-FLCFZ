/**
 * mockAuth.ts
 * 仅在 USE_MOCK=true 时使用：本地账号校验与注册。
 *
 * 真正的会话管理请见 auth/session.ts（基于 Token），
 * 登录成功后由 services/mockApi.ts 生成 mock token 并通过 saveSessionToken 写入。
 */

export type UserRole = 'admin' | 'user';

export interface Account {
  username: string;
  password: string;
  role: UserRole;
}

const ACCOUNTS_KEY = 'psych_prototype_accounts';

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
    const hasAdmin = parsed.some(
      (item) => item.username === 'adminer' && item.password === 'admin'
    );
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

export function login(
  username: string,
  password: string,
  _remember: boolean
): { ok: boolean; message?: string; role?: UserRole } {
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) return { ok: false, message: '用户名和密码不能为空' };

  if (u === 'adminer' && p === 'admin') {
    return { ok: true, role: 'admin' };
  }

  const accounts = readAccounts();
  const matched = accounts.find(
    (item) => item.username === u && item.password === p && item.role === 'user'
  );
  if (!matched) return { ok: false, message: '账号或密码错误' };

  return { ok: true, role: 'user' };
}

export function register(
  username: string,
  password: string
): { ok: boolean; message?: string } {
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) return { ok: false, message: '用户名和密码不能为空' };

  const accounts = readAccounts();
  if (accounts.some((item) => item.username === u)) {
    return { ok: false, message: '用户名已存在' };
  }

  accounts.push({ username: u, password: p, role: 'user' });
  writeAccounts(accounts);
  return { ok: true };
}
