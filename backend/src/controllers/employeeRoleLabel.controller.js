import User from '../models/User.js';
import RoleLabel from '../models/RoleLabel.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  sanitizeUser,
} from '../utils/tokens.js';

import {
  audit,
} from '../utils/audit.js';

import {
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

/*
|--------------------------------------------------------------------------
| UPDATE EMPLOYEE HR ROLE LABEL
|--------------------------------------------------------------------------
|
| User.role is access control.
| User.roleLabel is HR / Master Data metadata.
| Keeping this endpoint separate prevents accidental permission changes.
|
*/
export const updateEmployeeRoleLabel =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const roleLabel =
        String(
          req.body?.roleLabel ||
          ''
        ).trim();

      if (!roleLabel) {
        throw new ValidationError(
          'Role is required.'
        );
      }

      const [
        user,
        role,
      ] =
        await Promise.all([
          User.findById(
            req.params.id
          ),

          RoleLabel.findOne({
            name:
              roleLabel,
          }),
        ]);

      if (!user) {
        throw new NotFoundError(
          'Employee not found.'
        );
      }

      if (!role) {
        throw new ValidationError(
          'Unknown Role. Select a Role from Master Data or create it first.'
        );
      }

      const previousRole =
        user.roleLabel || '';

      user.roleLabel =
        role.name;

      await user.save();

      await audit({
        actorId:
          req.currentUser._id,

        actorName:
          req.currentUser.fullName,

        action:
          'EDIT_EMPLOYEE',

        targetType:
          'User',

        targetId:
          user._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        details:
          `Updated HR Role from "${previousRole || 'None'}" to "${user.roleLabel}".`,
      });

      res.json({
        success: true,
        data:
          sanitizeUser(
            user
          ),
      });
    }
  );
