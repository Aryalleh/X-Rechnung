/**
 * KoSIT validator adapter.
 *
 * The official KoSIT validator is a Java service that runs OUTSIDE the Worker.
 * We define a transport-agnostic interface and an HTTP implementation that
 * reads its URL from settings and its API key from the encrypted secret store.
 * Until a real endpoint is configured, strict validation is NOT available and
 * we NEVER report "fully valid" — status stays BASIC_CHECK_ONLY.
 *
 * A local mock is provided for tests / offline development; it is explicitly
 * labelled as a mock and never claims official conformance.
 */

export interface StrictValidationOutcome {
  status: 'STRICT_VALID' | 'STRICT_INVALID' | 'BASIC_CHECK_ONLY' | 'PROCESSING_ERROR';
  validatorName: string;
  validatorVersion: string | null;
  rulesetVersion: string | null;
  report: unknown;
  messages: string[];
}

export interface StrictValidator {
  readonly configured: boolean;
  validate(xml: string): Promise<StrictValidationOutcome>;
}

export interface KositConfig {
  url: string;
  apiKey: string | null;
  timeoutMs: number;
  retries: number;
}

/** Adapter that is not configured — always BASIC_CHECK_ONLY. */
export class UnconfiguredValidator implements StrictValidator {
  readonly configured = false;
  async validate(): Promise<StrictValidationOutcome> {
    return {
      status: 'BASIC_CHECK_ONLY',
      validatorName: 'none',
      validatorVersion: null,
      rulesetVersion: null,
      report: null,
      messages: ['اعتبارسنجی رسمی تنظیم نشده است.'],
    };
  }
}

/** HTTP adapter for a deployed KoSIT validator service. */
export class KositHttpValidator implements StrictValidator {
  readonly configured = true;
  constructor(private cfg: KositConfig) {}

  async validate(xml: string): Promise<StrictValidationOutcome> {
    let lastError = '';
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
        const res = await fetch(this.cfg.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/xml',
            ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          },
          body: xml,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          lastError = `KoSIT HTTP ${res.status}`;
          continue;
        }
        const report = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        // Expect the service to return {valid: boolean, engineVersion, scenario, messages}.
        const valid = Boolean(report.valid);
        return {
          status: valid ? 'STRICT_VALID' : 'STRICT_INVALID',
          validatorName: 'KoSIT',
          validatorVersion: (report.engineVersion as string) ?? null,
          rulesetVersion: (report.scenario as string) ?? null,
          report,
          messages: Array.isArray(report.messages) ? (report.messages as string[]) : [],
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      status: 'PROCESSING_ERROR',
      validatorName: 'KoSIT',
      validatorVersion: null,
      rulesetVersion: null,
      report: { error: lastError },
      messages: [`KoSIT validation error: ${lastError}`],
    };
  }
}

/** Deterministic local mock (tests/dev). Clearly NOT the official validator. */
export class MockKositValidator implements StrictValidator {
  readonly configured = true;
  constructor(private forceValid = true) {}
  async validate(): Promise<StrictValidationOutcome> {
    return {
      status: this.forceValid ? 'STRICT_VALID' : 'STRICT_INVALID',
      validatorName: 'MOCK-KoSIT (not official)',
      validatorVersion: 'mock-1',
      rulesetVersion: 'mock-ruleset',
      report: { mock: true },
      messages: ['MOCK validator — nicht die offizielle KoSIT-Prüfung.'],
    };
  }
}
