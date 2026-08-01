import type { Env } from './config/env';

/** Authenticated actor derived from the Cloudflare Access JWT. */
export interface Actor {
  email: string;
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'READ_ONLY';
  identityId?: string;
}

/** Hono generic bindings + per-request variables. */
export interface HonoEnv {
  Bindings: Env;
  Variables: {
    actor?: Actor;
    requestId: string;
    setupState: 'SETUP_REQUIRED' | 'IN_PROGRESS' | 'ACTIVE' | 'RECOVERY';
  };
}
