/**
 * Setup gate.
 *
 * Fresh deploy => SETUP_REQUIRED: the whole app is inert except /api/setup/*.
 * No setup secret: the first user to submit the owner form becomes OWNER
 * (see setup-service claimSetup). After setup completes the
 * state flips to ACTIVE and /api/setup/* is closed.
 */
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../http-types';
import { AppError } from '../lib/errors';
import { ensureSetupState } from '../services/setup-service';

export const setupGate: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const state = await ensureSetupState(c.env, c.executionCtx);
  c.set('setupState', state);

  const path = c.req.path;
  const isSetupApi = path.startsWith('/api/setup');
  const isRecoveryApi = path.startsWith('/api/recovery');
  const isPublicStatus = path === '/api/system/bootstrap';

  if (state === 'ACTIVE') {
    // Setup is closed once active; recovery has its own out-of-band flow.
    if (isSetupApi) throw new AppError('CONFLICT', 'Setup already completed');
    await next();
    return;
  }

  if (state === 'RECOVERY') {
    if (isRecoveryApi || isPublicStatus) {
      await next();
      return;
    }
    throw new AppError('SETUP_REQUIRED', 'System is in recovery mode');
  }

  // SETUP_REQUIRED / IN_PROGRESS
  if (isSetupApi || isPublicStatus) {
    await next();
    return;
  }
  if (path.startsWith('/api/')) {
    throw new AppError('SETUP_REQUIRED');
  }
  // Non-API (SPA shell) is served so the /setup UI can load.
  await next();
};
