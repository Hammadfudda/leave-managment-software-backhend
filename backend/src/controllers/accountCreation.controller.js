import bcrypt from 'bcryptjs';

import User from '../models/User.js';
import Grade from '../models/Grade.js';
import RoleLabel from '../models/RoleLabel.js';
import Department from '../models/Department.js';
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
  formatLeaveYearStart,
  getOrganizationLeaveYearConfig,
  parseLeaveYearStart,
} from '../services/leaveYear.service.js';

import {
  generateTemporaryPassword,
  sendTemporaryAccountEmail,
} from '../services/temporaryPassword.service.js';

/*
 * Portal Access remains employee / manager.
 * roleLabel is retained as the database compatibility field, but its
 * user-visible meaning is Division.
 */
export const createEmployeeWithTemporaryPassword =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const body =
        req.body;

      const divisionName =
        String(
          body.division ||
          body.roleLabel ||
          ''
        ).trim();

      const required = [
        'fullName',
        'email',
        'cnic',
        'role',
        'gradeId',
        'employeeId',
        'designation',
        'department',
        'dateOfJoining',
      ];

      const missing =
        required.filter(
          (field) =>
            !body[field]
        );

      if (!divisionName) {
        missing.push(
          'division'
        );
      }

      if (missing.length) {
        throw new ValidationError(
          'Missing required fields.',
          Object.fromEntries(
            missing.map(
              (field) => [
                field,
                'Required',
              ]
            )
          )
        );
      }

      if (
        ![
          'employee',
          'manager',
        ].includes(
          body.role
        )
      ) {
        throw new ValidationError(
          'Only Employee or Manager accounts can be created here.'
        );
      }

      const email =
        String(
          body.email
        ).toLowerCase();

      const duplicate =
        await User.findOne({
          $or: [
            {
              email,
            },
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
        selectedDivision,
        selectedDepartment,
        leaveYearConfig,
      ] =
        await Promise.all([
          Grade.findById(
            body.gradeId
          ),

          RoleLabel.findOne({
            name:
              divisionName,
          }),

          Department.findOne({
            name:
              String(
                body.department
              ).trim(),
          }),

          getOrganizationLeaveYearConfig(
            req.currentUser.organizationId
          ),
        ]);

      if (!grade) {
        throw new ValidationError(
          'Unknown grade.'
        );
      }

      if (!selectedDivision) {
        throw new ValidationError(
          'Unknown Division. Select a Division from Master Data or create it first.'
        );
      }

      if (!selectedDepartment) {
        throw new ValidationError(
          'Unknown Department. Select a Department from Master Data or create it first.'
        );
      }

      if (
        selectedDepartment.divisionName &&
        selectedDepartment.divisionName !==
          selectedDivision.name
      ) {
        throw new ValidationError(
          `Department "${selectedDepartment.name}" belongs to Division "${selectedDepartment.divisionName}", not "${selectedDivision.name}".`
        );
      }

      /*
       * Legacy departments can be linked safely on first valid employee create.
       */
      if (
        !selectedDepartment.divisionName
      ) {
        selectedDepartment.divisionName =
          selectedDivision.name;

        await selectedDepartment.save();
      }

      /*
       * Organization setting is authoritative. If the frontend sends the
       * visible value, it must match exactly.
       */
      if (
        body.leaveYearStart
      ) {
        const supplied =
          parseLeaveYearStart(
            body.leaveYearStart
          );

        if (
          !supplied ||
          supplied.day !==
            leaveYearConfig.day ||
          supplied.month !==
            leaveYearConfig.month
        ) {
          throw new ValidationError(
            `Leave Year Start must match the organization setting (${formatLeaveYearStart(
              leaveYearConfig
            )}).`
          );
        }
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
            selectedDivision.name,

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
            selectedDepartment.name,

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
          `Created ${user.role} ${user.fullName} (${user.employeeId}) in Division "${user.roleLabel}" with mandatory temporary-password change.`,
      });

      return res
        .status(201)
        .json({
          success: true,
          data:
            sanitizeUser(
              user
            ),
          emailSent,
        });
    }
  );
