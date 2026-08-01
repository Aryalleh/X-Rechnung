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
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    throw new AppError('VALIDATION_ERROR', 'schema validation failed', fields);
  }
  return result.data;
}
