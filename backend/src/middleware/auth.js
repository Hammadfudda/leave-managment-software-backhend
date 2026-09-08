import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Spec Part 3.2 — req.user.role always comes from the verified JWT, never from
 * the request body. No endpoint trusts a client-supplied role or user ID.
 */
export function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET); // { id, role }
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    next();
  };
}

/**
 * Loads the full User document for handlers that need more than { id, role }.
 * A user whose account is no longer active is rejected immediately, so a
 * removed employee's still-valid access token stops working right away
 * (Part 4).
 */
export const loadUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  req.currentUser = user;
  next();
});
