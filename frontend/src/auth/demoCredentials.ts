import { USE_MOCK } from '../services/http';

// Public demo credentials, never production staff credentials. Deployments can override.
export const adminDemo = USE_MOCK
  ? { username: 'adminer', password: 'admin' }
  : { username: import.meta.env.VITE_ADMIN_DEMO_USERNAME || 'adminer',
      password: import.meta.env.VITE_ADMIN_DEMO_PASSWORD || 'admin' };
