/**
 * Shared utilities for financial tools.
 */

/** Sub-tool timeout in milliseconds. Returns partial results on timeout. */
export const SUB_TOOL_TIMEOUT_MS = 15_000;

/** Cache TTL constants. */
export const TTL_15M = 15 * 60 * 1000;
export const TTL_1H = 60 * 60 * 1000;
export const TTL_6H = 6 * 60 * 60 * 1000;
export const TTL_24H = 24 * 60 * 60 * 1000;

/**
 * Uppercase only ASCII letters while leaving CJK and symbols untouched.
 * This keeps Japanese labels readable while normalizing identifiers like FY/annual.
 */
export function normalizeAsciiUpper(value: string | undefined): string {
  return (value ?? '').trim().replace(/[a-z]/g, (char) => char.toUpperCase());
}

/**
 * True when a period type represents a full-year / annual disclosure.
 */
export function isAnnualPeriodType(periodType: string | undefined): boolean {
  const raw = (periodType ?? '').trim();
  if (!raw) {
    return false;
  }

  const asciiNormalized = normalizeAsciiUpper(raw);

  return (
    asciiNormalized === 'FY' ||
    asciiNormalized.includes('ANNUAL') ||
    raw.includes('通期') ||
    raw.includes('年度')
  );
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error
 * if the promise doesn't settle within `ms` milliseconds.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label ?? 'Operation'} timed out after ${ms / 1000}s`)),
        ms,
      ),
    ),
  ]);
}
