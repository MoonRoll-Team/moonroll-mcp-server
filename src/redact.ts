// Single source of truth for sensitive-field handling.

// Keys stripped recursively from every tool response, wherever they appear
// (top-level, embedded in $lookup results, nested subdocuments, arrays).
export const SENSITIVE_KEYS = new Set([
  'password',
  'pkSol',
  'intercomHash',
]);

// 'nonce' is only sensitive as a string (users.nonce is the wallet-auth
// challenge). Integer nonces (bets.nonce, blockchain tx nonces) are the
// provable-fairness / tx counters and must survive redaction.
function isSensitive(key: string, value: unknown): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  return key === 'nonce' && typeof value === 'string';
}

// Projection applied to direct queries on the users collection (cheaper than
// shipping the data and redacting it afterwards; redactDeep remains the net).
export const SENSITIVE_PROJECTION: Record<string, 0> = {
  password: 0,
  nonce: 0,
  'cryptoAddresses.pkSol': 0,
  intercomHash: 0,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Returns a copy of `value` with all SENSITIVE_KEYS removed at any depth.
// Non-plain objects (ObjectId, Date, Decimal128, Binary, ...) are returned
// as-is so their JSON serialization is preserved.
export function redactDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitive(key, val)) continue;
      out[key] = redactDeep(val);
    }
    return out as unknown as T;
  }
  return value;
}
