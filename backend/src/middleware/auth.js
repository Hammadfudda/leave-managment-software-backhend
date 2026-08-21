import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { runWithTenant } from '../utils/tenantContext.js';

/**
 * Spec Part 3.2 — req.user.role always comes from the verified JWT, never from
 * the request body. No endpoint trusts a client-supplied role or user ID.
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log('===== AUTH DEBUG =====');
  console.log('Authorization header exists:', Boolean(authHeader));

  const token = authHeader?.split(' ')[1];

  console.log('Token extracted:', Boolean(token));

  if (!token) {
    console.log('AUTH RESULT: No token');
    console.log('======================');

    return res.status(401).json({
      success: false,
      message: 'Not authenticated',
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET
    );

    console.log('JWT verified successfully');
    console.log('User ID:', decoded.id);
    console.log('Role:', decoded.role);
    console.log('Issued At:', decoded.iat);
    console.log('Expires At:', decoded.exp);
    console.log('======================');

    req.user = decoded;
    return next();
  } catch (err) {
    console.log('JWT verification failed');
    console.log('JWT error name:', err.name);
    console.log('JWT error message:', err.message);
    console.log('======================');

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    next();
  };
}

/**
 * Loads the full User document for handlers that need more than { id, role }.
 * A user whose account is no longer active is rejected immediately.
 *
 * SaaS addition:
 * - validates the user's Organization is active
 * - starts tenant context for every downstream controller/service/model query
 * - suspended Organization blocks Admin + Manager + Employee immediately
 */
export const loadUser = asyncHandler(
  async (req, res, next) => {
    // No tenant context exists yet, so this lookup can find the login user.
    const user = await User.findById(req.user.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    if (user.organizationId) {
      const organization = await Organization.findById(
        user.organizationId
      )
        .select('status')
        .lean();

      if (!organization || organization.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Organization access is suspended.',
          code: 'ORGANIZATION_SUSPENDED',
        });
      }
    }

    req.currentUser = user;

    return runWithTenant(
      user.organizationId ?? null,
      () => next()
    );
  }
);
