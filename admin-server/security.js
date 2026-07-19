/**
 * Security helpers — CORS, password hashing, response headers.
 */
const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  if (raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    'http://localhost:8790',
    'http://127.0.0.1:8790',
    'http://localhost:8765',
    'http://127.0.0.1:8765',
  ];
}

let allowedOriginsCache = null;

function getAllowedOrigins() {
  if (!allowedOriginsCache) {
    allowedOriginsCache = parseAllowedOrigins();
  }
  return allowedOriginsCache;
}

function resolveCorsOrigin(req) {
  if (!req) return { allowed: true, origin: null };
  const origin = req.headers.origin;
  if (!origin) return { allowed: true, origin: null };

  const allowed = getAllowedOrigins();
  if (allowed.includes('*')) return { allowed: true, origin: '*' };
  if (allowed.includes(origin)) return { allowed: true, origin };

  return { allowed: false, origin };
}

function isCrossOriginDenied(req) {
  const { allowed, origin } = resolveCorsOrigin(req);
  return !!origin && !allowed;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

function verifyPasswordHash(pw, stored) {
  if (!stored || !pw) return false;

  if (String(stored).startsWith('scrypt:')) {
    const parts = String(stored).split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const expected = Buffer.from(parts[2], 'hex');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const derived = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(expected, derived);
  }

  const legacy = crypto.createHash('sha256').update(pw).digest('hex');
  const a = Buffer.from(legacy, 'utf8');
  const b = Buffer.from(String(stored), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLegacyPasswordHash(stored) {
  return stored && !String(stored).startsWith('scrypt:');
}

function buildApiHeaders(req, contentType = 'application/json') {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  const { allowed, origin } = resolveCorsOrigin(req);
  if (origin && allowed) {
    headers['Access-Control-Allow-Origin'] = origin === '*' ? '*' : origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  }

  return headers;
}

function buildStaticHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

module.exports = {
  getAllowedOrigins,
  isCrossOriginDenied,
  hashPassword,
  verifyPasswordHash,
  isLegacyPasswordHash,
  buildApiHeaders,
  buildStaticHeaders,
};
