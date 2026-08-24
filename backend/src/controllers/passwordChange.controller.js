import bcrypt from 'bcryptjs';

import User from '../models/User.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  refreshCookieOptions,
} from '../utils/tokens.js';

import {
  ValidationError,
} from '../utils/errors.js';

export const changePassword =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const currentPassword =
        String(
          req.body.currentPassword ||
          ''
        );

      const newPassword =
        String(
          req.body.newPassword ||
          ''
        );

      if (
        !currentPassword ||
        !newPassword
      ) {
        throw new ValidationError(
          'Current password and new password are required.'
        );
      }

      if (
        newPassword.length < 8
      ) {
        throw new ValidationError(
          'New password must be at least 8 characters.'
        );
      }

      if (
        currentPassword ===
        newPassword
      ) {
        throw new ValidationError(
          'New password must be different from your temporary/current password.'
        );
      }

      const user =
        await User.findById(
          req.currentUser._id
        );

      if (!user) {
        throw new ValidationError(
          'Account was not found.'
        );
      }

      const currentMatches =
        await bcrypt.compare(
          currentPassword,
          user.passwordHash
        );

      if (!currentMatches) {
        throw new ValidationError(
          'Current password is incorrect.'
        );
      }

      user.passwordHash =
        await bcrypt.hash(
          newPassword,
          12
        );

      user.passwordChangedFromDefault =
        true;

      user.mustChangePassword =
        false;

      // Revoke the current refresh session after a sensitive credential change.
      user.refreshTokenHash =
        null;

      user.passwordResetTokenHash =
        null;

      user.passwordResetExpires =
        null;

      user.failedLoginAttempts =
        0;

      user.lockedUntil =
        null;

      await user.save();

      res.clearCookie(
        'refreshToken',
        {
          ...refreshCookieOptions(),
          maxAge:
            undefined,
        }
      );

      return res.json({
        success: true,
        mustLoginAgain: true,
        data: {
          message:
            'Password updated successfully. Please sign in again with your new password.',
        },
      });
    }
  );
