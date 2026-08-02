import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import LoginHistory from '../models/LoginHistory.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  signAccessToken,
  signRefreshToken,
  refreshCookieOptions,
  sanitizeUser,
} from '../utils/tokens.js';
import { sendEmail, templates } from '../services/email.service.js';
import { ValidationError } from '../utils/errors.js';

/** Spec Part 3.1 — Login. CNIC is the default password (bcrypt-hashed at creation). */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ValidationError('Email and password are required.');

  const user = await User.findOne({ email: String(email).toLowerCase() });

  // Same generic error whether the email doesn't exist, the account was
  // removed, or the password is wrong. Never let the response shape reveal which.
  const invalid = () => res.status(401).json({ success: false, message: 'Invalid credentials' });

  if (!user) return invalid();
  // This is what makes a removed employee's login stop immediately.
  if (user.status !== 'active') return invalid();
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    return res
      .status(423)
      .json({ success: false, message: 'Account temporarily locked. Try again later.' });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= 5) {
      user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
    await user.save();
    await LoginHistory.create({
      userId: user._id,
      successful: false,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return invalid();
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();

  await LoginHistory.create({
    userId: user._id,
    successful: true,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await user.save();

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return res.json({ success: true, accessToken, user: sanitizeUser(user) });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      await User.findByIdAndUpdate(payload.id, { refreshTokenHash: null });
    } catch {
      /* an expired or forged cookie still just clears the session */
    }
  }
  res.clearCookie('refreshToken', { ...refreshCookieOptions(), maxAge: undefined });
  return res.json({ success: true, data: { message: 'Logged out' } });
});

/** Rotation on refresh (Part 12) — the old refresh token stops working. */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  const user = await User.findById(payload.id);
  if (!user || user.status !== 'active' || !user.refreshTokenHash) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  const matches = await bcrypt.compare(token, user.refreshTokenHash);
  if (!matches) {
    // Token reuse / revoked session — drop every session for this user.
    user.refreshTokenHash = null;
    await user.save();
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  const accessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
  await user.save();

  res.cookie('refreshToken', newRefreshToken, refreshCookieOptions());
  return res.json({ success: true, accessToken, user: sanitizeUser(user) });
});

/** Always responds identically, so it can't be used to enumerate accounts. */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const generic = {
    success: true,
    data: { message: 'If that account exists, a reset link has been sent.' },
  };
  if (!email) return res.json(generic);

  const user = await User.findOne({ email: String(email).toLowerCase(), status: 'active' });
  if (!user) return res.json(generic);

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const url = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    html: templates.passwordReset(user, url),
  });

  return res.json(generic);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw new ValidationError('Token and new password are required.');
  if (String(password).length < 8) {
    throw new ValidationError('Password must be at least 8 characters.');
  }

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetTokenHash: hashed,
    passwordResetExpires: { $gt: new Date() },
    status: 'active',
  });
  if (!user) {
    return res.status(400).json({ success: false, message: 'Reset link is invalid or expired.' });
  }

  user.passwordHash = await bcrypt.hash(password, 10);
  user.passwordChangedFromDefault = true;
  user.passwordResetTokenHash = null;
  user.passwordResetExpires = null;
  user.refreshTokenHash = null; // force re-login everywhere
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  return res.json({ success: true, data: { message: 'Password updated. Please sign in.' } });
});
