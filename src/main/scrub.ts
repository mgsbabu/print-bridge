const SENSITIVE_KEY_PATTERNS = [
  /payloadBase64/i,
  /^token$/i,
  /tokenEnc/i,
  /x-bridge-token/i,
  /bridgeToken/i,
  /authorization/i,
  /cookie/i,
];

const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Walk an arbitrary value and redact anything whose key matches a
 * sensitive pattern. Returns a new structure; never mutates input.
 * Cycles are not expected in Sentry payloads — guarded with a small
 * depth cap as a belt-and-braces precaution.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 16 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else if (v && typeof v === "object") {
      out[k] = scrub(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Defang base64-looking blobs that leak into free-form strings (error
 * messages, breadcrumb messages). Heuristic: > 256 chars and looks
 * like base64 from the first 64 characters.
 */
export function scrubString(s: string): string {
  if (s.length <= 256) return s;
  if (/^[A-Za-z0-9+/=]+$/.test(s.slice(0, 64))) return "[BASE64 REDACTED]";
  return s;
}
