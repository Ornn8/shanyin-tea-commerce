/**
 * Server-side validation for the minimum documented checkout fields
 * (Issue #6, ADR-0008).
 *
 * The checkout collects ONLY the fields needed to place and deliver an order:
 * a contact email plus a shipping address. Clients can never trust their own
 * validation — every field is re-validated here before an order is created.
 * Errors are returned as per-field CODES (`required` / `invalidEmail` /
 * `tooLong` / `invalidCountry`) that the client maps onto localized copy; the
 * server never formats translated strings and never echoes user input into
 * error copy (no unsafe interpolation).
 *
 * This module is PURE (no imports) so it is unit-testable in isolation.
 */

export const CHECKOUT_FIELDS = [
  'email',
  'recipientName',
  'addressLine1',
  'city',
  'region',
  'postalCode',
  'countryCode',
] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

export const CHECKOUT_FIELD_MAX_LENGTHS: Readonly<Record<CheckoutField, number>> = {
  email: 200,
  recipientName: 100,
  addressLine1: 200,
  city: 100,
  region: 100,
  postalCode: 20,
  countryCode: 2,
};

export type CheckoutFieldErrorCode = 'required' | 'invalidEmail' | 'tooLong' | 'invalidCountry';

export type CheckoutFieldErrors = Partial<Record<CheckoutField, CheckoutFieldErrorCode>>;

export interface CheckoutFieldsInput {
  email?: unknown;
  recipientName?: unknown;
  addressLine1?: unknown;
  city?: unknown;
  region?: unknown;
  postalCode?: unknown;
  countryCode?: unknown;
}

export type CheckoutValidationResult =
  | { ok: true; values: { email: string; recipientName: string; addressLine1: string; city: string; region: string; postalCode: string; countryCode: string } }
  | { ok: false; errors: CheckoutFieldErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/** Validate the checkout form server-side. Returns normalized values on
 * success, per-field error codes on failure. */
export function validateCheckoutFields(input: CheckoutFieldsInput): CheckoutValidationResult {
  const errors: CheckoutFieldErrors = {};

  const email = asString(input.email);
  const recipientName = asString(input.recipientName);
  const addressLine1 = asString(input.addressLine1);
  const city = asString(input.city);
  const region = asString(input.region);
  const postalCode = asString(input.postalCode);
  const countryCode = asString(input.countryCode);

  const required: Record<CheckoutField, string | null> = {
    email,
    recipientName,
    addressLine1,
    city,
    region,
    postalCode,
    countryCode,
  };

  for (const field of CHECKOUT_FIELDS) {
    const value = required[field];
    if (!value || value.length === 0) {
      errors[field] = 'required';
    } else if (value.length > CHECKOUT_FIELD_MAX_LENGTHS[field]) {
      errors[field] = 'tooLong';
    }
  }

  if (email && EMAIL_RE.test(email) === false) {
    errors.email = 'invalidEmail';
  }
  if (countryCode && /^[A-Za-z]{2}$/.test(countryCode) === false) {
    errors.countryCode = 'invalidCountry';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      email: email as string,
      recipientName: recipientName as string,
      addressLine1: addressLine1 as string,
      city: city as string,
      region: region as string,
      postalCode: postalCode as string,
      countryCode: (countryCode as string).toUpperCase(),
    },
  };
}
