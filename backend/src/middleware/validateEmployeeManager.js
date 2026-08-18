import mongoose from 'mongoose';

import User from '../models/User.js';
import Department from '../models/Department.js';

import {
  ValidationError,
} from '../utils/errors.js';

function clean(value) {
  return String(
    value ?? ''
  ).trim();
}

function escapeRegex(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}

export async function validateEmployeeManager(
  req,
  res,
  next
) {
  try {
    /*
     * No manager selected.
     *
     * This is allowed.
     */
    if (!req.body.managerId) {
      req.body.managerId =
        null;

      return next();
    }

    const managerId =
      clean(
        req.body.managerId
      );

    /*
     * Prevent invalid MongoDB IDs
     * from reaching Mongoose.
     */
    if (
      !mongoose.Types.ObjectId.isValid(
        managerId
      )
    ) {
      throw new ValidationError(
        'Selected manager is invalid.'
      );
    }

    /*
     * Department is required
     * when a manager is selected.
     */
    const departmentName =
      clean(
        req.body.department
      );

    if (!departmentName) {
      throw new ValidationError(
        'Please select a department before selecting a manager.'
      );
    }

    /*
     * Verify department really exists
     * in Master Data.
     */
    const department =
      await Department.findOne({
        name: {
          $regex:
            `^${escapeRegex(
              departmentName
            )}$`,

          $options:
            'i',
        },
      });

    if (!department) {
      throw new ValidationError(
        'Selected department does not exist in Master Data.'
      );
    }

    /*
     * Manager must:
     * - exist
     * - have manager role
     * - be active
     */
    const manager =
      await User.findOne({
        _id:
          managerId,

        role:
          'manager',

        status:
          'active',
      });

    if (!manager) {
      throw new ValidationError(
        'Selected manager does not exist or is not an active Manager.'
      );
    }

    /*
     * STRICT DEPARTMENT RULE
     *
     * Engineering employee
     * → Engineering manager only
     *
     * HR employee
     * → HR manager only
     */
    if (
      clean(
        manager.department
      ).toLowerCase() !==
      clean(
        department.name
      ).toLowerCase()
    ) {
      throw new ValidationError(
        `Selected manager belongs to "${manager.department}", but this employee belongs to "${department.name}". Please select a manager from the same department.`
      );
    }

    /*
     * Use verified MongoDB ID.
     */
    req.body.managerId =
      manager._id;

    next();
  } catch (error) {
    next(error);
  }
}