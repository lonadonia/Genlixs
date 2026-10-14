import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacBase64 = (key: string, message: string) => createHmac("sha256", key).update(message).digest("base64");
export const hmacHex = (key: string, message: string) => createHmac("sha256", key).update(message).digest("hex");

/** `value.signature` cookie payloads (referral attribution, §18.2). */
export function signValue(key: string, value: string) {
  return `${value}.${createHmac("sha256", key).update(value).digest("base64url")}`;
}

export function verifySignedValue(key: string, signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(signValue(key, value), signed) ? value : null;
}

/** Bearer token check for machine endpoints (internal workers). */
export function bearerMatches(header: string | null, expected: string | undefined) {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), expected);
}
