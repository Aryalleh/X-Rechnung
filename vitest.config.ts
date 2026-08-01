import { defineConfig } from 'vitest/config';

// Unit tests run in Node for speed and determinism (pure logic: money math,
// crypto/hashing, XML parsing, e-invoice extraction, Kleinunternehmer rules,
// ZIP integrity). Full integration tests against D1/R2/Durable Objects/Queues
// run inside workerd via `@cloudflare/vitest-pool-workers` — see
// EINVOICE_VALIDATION.md / README for the wrangler-backed config. Both use the
// same source modules; nothing here mocks away the real calculation code.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
