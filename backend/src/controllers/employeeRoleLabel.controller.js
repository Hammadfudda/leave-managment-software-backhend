import User from '../models/User.js';
import RoleLabel from '../models/RoleLabel.js';
import Department from '../models/Department.js';

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
 * Existing endpoint path /role-label is retained for compatibility.
 * Its user-visible meaning is now Division.
 */
export const updateEmployeeRoleLabel =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const divisionName =
        String(
          req.body?.division ||
          req.body?.roleLabel ||
          ''
        ).trim();

      if (!divisionName) {
        throw new ValidationError(
          'Division is required.'
        );
      }

      const [
        user,
        selectedDivision,
      ] =
        await Promise.all([
          User.findById(
            req.params.id
          ),

          RoleLabel.findOne({
            name:
              divisionName,
          }),
        ]);

      if (!user) {
        throw new NotFoundError(
          'Employee not found.'
        );
      }

      if (!selectedDivision) {
        throw new ValidationError(
          'Unknown Division. Select a Division from Master Data or create it first.'
        );
      }

      const department =
        user.department
          ? await Department.findOne({
              name:
                user.department,
            })
          : null;

      if (
        department?.divisionName &&
        department.divisionName !==
          selectedDivision.name
      ) {
        throw new ValidationError(
          `Department "${department.name}" belongs to Division "${department.divisionName}", not "${selectedDivision.name}".`
        );
      }

      if (
        department &&
        !department.divisionName
      ) {
        department.divisionName =
          selectedDivision.name;

        await department.save();
      }

      const previousDivision =
        user.roleLabel ||
        '';

      user.roleLabel =
        selectedDivision.name;

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
          `Updated Division from "${previousDivision || 'None'}" to "${user.roleLabel}".`,
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
