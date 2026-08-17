/**
 * Admin domain error. Carries a stable `code` (for the UI and tests) and
 * optional per-field messages keyed by dotted paths such as
 * `variants[0].sku` or `localizations.en.name`.
 */
export class AdminError extends Error {
  readonly code: string;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: string,
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** Coerce an unknown thrown value into an AdminError (fallback for non-domain errors). */
export function toAdminError(error: unknown, fallbackCode = 'unexpected'): AdminError {
  if (error instanceof AdminError) return error;
  if (error instanceof Error) {
    return new AdminError(fallbackCode, error.message);
  }
  return new AdminError(fallbackCode, 'Unexpected error.');
}
