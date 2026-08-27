import bcrypt from 'bcryptjs';

import User from '../models/User.js';
import Grade from '../models/Grade.js';
import RoleLabel from '../models/RoleLabel.js';
import LeaveBalance from '../models/LeaveBalance.js';

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
  ConflictError,
  ValidationError,
} from '../utils/errors.js';

import {
  initializeLeaveBalances,
} from '../services/balance.service.js';

import {
  generateTemporaryPassword,
  sendTemporaryAccountEmail,
} from '../services/temporaryPassword.service.js';

/*
|--------------------------------------------------------------------------
| CREATE EMPLOYEE / MANAGER WITH TEMPORARY PASSWORD
|--------------------------------------------------------------------------
|
| Portal access remains employee / manager.
| roleLabel is the separate HR role selected from Master Data.
|
*/
export const createEmployeeWithTemporaryPassword =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const body = req.body;

      const required = [
        'fullName',
        'email',
        'cnic',
        'role',
        'roleLabel',
        'gradeId',
        'employeeId',
        'designation',
        'department',
        'dateOfJoining',
      ];

      const missing = required.filter(
        (field) => !body[field]
      );

      if (missing.length) {
        throw new ValidationError(
          'Missing required fields.',
          Object.fromEntries(
            missing.map((field) => [
              field,
              'Required',
            ])
          )
        );
      }

      if (
        ![
          'employee',
          'manager',
        ].includes(body.role)
      ) {
        throw new ValidationError(
          'Only Employee or Manager accounts can be created here.'
        );
      }

      const email = String(
        body.email
      ).toLowerCase();

      const duplicate =
        await User.findOne({
          $or: [
            { email },
            {
              nationalId:
                body.cnic,
            },
            {
              employeeId:
                body.employeeId,
            },
          ],
        });

      if (duplicate) {
        throw new ConflictError(
          'An employee with that email, CNIC or ID already exists.'
        );
      }

      const [
        grade,
        selectedRoleLabel,
      ] =
        await Promise.all([
          Grade.findById(
            body.gradeId
          ),

          RoleLabel.findOne({
            name:
              String(
                body.roleLabel
              ).trim(),
          }),
        ]);

      if (!grade) {
        throw new ValidationError(
          'Unknown grade.'
        );
      }

      if (!selectedRoleLabel) {
        throw new ValidationError(
          'Unknown Role. Select a Role from Master Data or create it first.'
        );
      }

      const temporaryPassword =
        generateTemporaryPassword();

      const user =
        await User.create({
          fullName:
            body.fullName,

          email,

          nationalId:
            body.cnic,

          cnic:
            body.cnic,

          passwordHash:
            await bcrypt.hash(
              temporaryPassword,
              12
            ),

          passwordChangedFromDefault:
            false,

          mustChangePassword:
            true,

          role:
            body.role,

          roleLabel:
            selectedRoleLabel.name,

          gradeId:
            grade._id,

          managerId:
            body.managerId ||
            null,

          canApproveOtherDepartments:
            body.role ===
            'manager'
              ? Boolean(
                  body.canApproveOtherDepartments
                )
              : false,

          employeeId:
            body.employeeId,

          designation:
            body.designation,

          department:
            body.department,

          phone:
            body.phone,

          dateOfJoining:
            new Date(
              body.dateOfJoining
            ),

          profilePhotoUrl:
            body.profilePhotoUrl,
        });

      await initializeLeaveBalances(
        user._id,
        grade
      );

      /*
       * Email account label intentionally remains Manager/Employee because
       * it describes portal access, not the HR roleLabel.
       */
      const emailSent =
        await sendTemporaryAccountEmail({
          to:
            user.email,
          fullName:
            user.fullName,
          roleLabel:
            user.role ===
            'manager'
              ? 'Manager'
              : 'Employee',
          temporaryPassword,
        });

      if (!emailSent) {
        await Promise.all([
          LeaveBalance.deleteMany({
            employeeId:
              user._id,
          }),

          User.deleteOne({
            _id:
              user._id,
          }),
        ]);

        throw new ValidationError(
          'Account email could not be sent, so the new account was not kept. Please check SMTP and try again.'
        );
      }

      await audit({
        actorId:
          req.currentUser._id,

        actorName:
          req.currentUser.fullName,

        action:
          'CREATE_EMPLOYEE',

        targetType:
          'User',

        targetId:
          user._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        details:
          `Created ${user.role} ${user.fullName} (${user.employeeId}) with HR Role "${user.roleLabel}" and mandatory temporary-password change.`,
      });

      return res
        .status(201)
        .json({
          success: true,
          data:
            sanitizeUser(user),
          emailSent,
        });
    }
  );
