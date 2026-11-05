import type { Context } from 'hono';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/** Parse + validate a JSON body against a Zod schema, throwing AppError on failure. */
export async function parseBody<S extends ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'invalid JSON body');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join('.') || '_'] = issueKey(issue);
    }
    throw new AppError('VALIDATION_ERROR', 'schema validation failed', fields);
  }
  return result.data;
}

/**
 * Stable, language-neutral key for a validation issue; the SPA translates it.
 * Custom messages that are already keys (snake_case) pass through.
 */
function issueKey(issue: { code: string; message: string; validation?: unknown; type?: string; minimum?: unknown }): string {
  if (/^[a-z0-9_]+$/.test(issue.message)) return issue.message;
  switch (issue.code) {
    case 'invalid_type':
      return issue.message === 'Required' ? 'required' : 'invalid';
    case 'invalid_string':
      return issue.validation === 'email' ? 'invalid_email' : 'invalid';
    case 'too_small':
      return issue.type === 'string' && issue.minimum === 1 ? 'required' : 'too_small';
    case 'too_big':
      return 'too_big';
    case 'invalid_enum_value':
      return 'invalid_option';
    default:
      return 'invalid';
  }
}
