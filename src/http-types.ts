import type { Env } from './config/env';

/** Authenticated actor: from a password session or a Cloudflare Access JWT. */
export interface Actor {
  email: string;
  /** MAIL_USER = mailbox-only user (admin_users.mail_only = 1). */
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'READ_ONLY' | 'MAIL_USER';
  /** The user's own mailbox address, if one is assigned. */
  mailAddress?: string | null;
  identityId?: string;
  /** admin_users.id (set for password sessions). */
  userId?: string;
  /** Hashed session id (set for password sessions). */
  sessionId?: string;
  via?: 'session' | 'access' | 'dev' | 'eas';
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
