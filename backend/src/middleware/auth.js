import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import Organization from '../models/Organization.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  runWithTenant,
} from '../utils/tenantContext.js';

export function authenticate(
  req,
  res,
  next
) {
  const authHeader =
    req.headers.authorization;

  const token =
    authHeader?.split(' ')[1];

  if (!token) {
    return res
      .status(401)
      .json({
        success: false,
        message:
          'Not authenticated',
      });
  }

  try {
    const decoded =
      jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET
      );

    req.user =
      decoded;

    return next();
  } catch {
    return res
      .status(401)
      .json({
        success: false,
        message:
          'Invalid or expired token',
      });
  }
}

export function authorize(
  ...allowedRoles
) {
  return (
    req,
    res,
    next
  ) => {
    if (
      !allowedRoles.includes(
        req.user.role
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            'Not authorized',
        });
    }

    next();
  };
}

function passwordChangeRouteAllowed(
  req
) {
  const path =
    String(
      req.originalUrl ||
      req.url ||
      ''
    ).split('?')[0];

  return (
    path.endsWith(
      '/employees/me'
    ) ||
    path.endsWith(
      '/auth/change-password'
    )
  );
}

export const loadUser =
  asyncHandler(
    async (
      req,
      res,
      next
    ) => {
      // No tenant context exists yet, so this lookup can find the login user.
      const user =
        await User.findById(
          req.user.id
        );

      if (
        !user ||
        user.status !==
          'active'
      ) {
        return res
          .status(401)
          .json({
            success: false,
            message:
              'Not authenticated',
          });
      }

      if (
        user.organizationId
      ) {
        const organization =
          await Organization.findById(
            user.organizationId
          )
            .select(
              'status'
            )
            .lean();

        if (
          !organization ||
          organization.status !==
            'active'
        ) {
          return res
            .status(403)
            .json({
              success: false,
              message:
                'Organization access is suspended.',
              code:
                'ORGANIZATION_SUSPENDED',
            });
        }
      }

      req.currentUser =
        user;

      /*
       * Backend source-of-truth enforcement:
       * Temporary-password users cannot access normal APIs until the
       * mandatory password change is completed.
       *
       * Existing/legacy users are NOT affected because mustChangePassword
       * defaults to false.
       */
      if (
        user.mustChangePassword ===
          true &&
        user.passwordChangedFromDefault !==
          true &&
        !passwordChangeRouteAllowed(
          req
        )
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              'You must change your temporary password before using the system.',
            code:
              'PASSWORD_CHANGE_REQUIRED',
          });
      }

      return runWithTenant(
        user.organizationId ??
          null,
        () => next()
      );
    }
  );
