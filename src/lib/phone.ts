import { ValidationError } from "./errors";

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Attempts to normalize an Indian mobile number (`+91 98765-43210` or `09876543210` -> `9876543210`).
 * Returns `null` if invalid.
 */
export function tryNormalizeIndianMobile(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject alphabetic characters early
  if (/[a-zA-Z]/.test(trimmed)) {
    return null;
  }

  let digits = trimmed.replace(/[\s\-().+]/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return INDIAN_MOBILE_REGEX.test(digits) ? digits : null;
}

/**
 * Normalizes an Indian 10-digit mobile number or throws `ValidationError`.
 */
export function normalizeIndianMobile(raw: string): string {
  const normalized = tryNormalizeIndianMobile(raw);
  if (!normalized) {
    throw new ValidationError("Please enter a valid 10-digit Indian mobile number.", {
      mobileNumber: ["Enter a valid 10-digit mobile number starting with 6–9."],
    });
  }
  return normalized;
}

/**
 * Masks a 10-digit mobile number for public customer views (`9876543210` -> `******3210`).
 */
export function maskMobileNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 4) {
    return "******";
  }
  return `******${digits.slice(-4)}`;
}
