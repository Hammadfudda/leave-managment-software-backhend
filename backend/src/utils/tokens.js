import jwt from 'jsonwebtoken';

export const ACCESS_TTL = '15m';
export const REFRESH_TTL = '7d';
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TTL }
  );
}

export function refreshCookieOptions() {
  // Production must always use HTTPS for the refresh credential. Local HTTP
  // development remains possible only when COOKIE_SECURE=false is explicitly set.
  const secure = process.env.COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/',
  };
}

/** Never expose passwordHash, refreshTokenHash or lockout internals. */
export function sanitizeUser(user) {
  const u = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete u.passwordHash;
  delete u.refreshTokenHash;
  delete u.failedLoginAttempts;
  delete u.lockedUntil;
  delete u.__v;
  // CNIC / nationalId are identity credentials and must not be returned by
  // general employee/profile APIs. Keep them available only to explicitly
  // authorized server-side workflows such as the employee CSV export.
  delete u.cnic;
  delete u.nationalId;
  return u;
}
