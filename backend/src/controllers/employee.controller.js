import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { Parser } from 'json2csv';

import User from '../models/User.js';
import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import LeaveRequest from '../models/LeaveRequest.js';

import { asyncHandler } from '../utils/asyncHandler.js';
import { sanitizeUser } from '../utils/tokens.js';
import { audit } from '../utils/audit.js';
import { getPagination, paginated } from '../utils/pagination.js';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  initializeLeaveBalances,
  syncQuotasToGrade,
  getLeaveBalancesForUser,
} from '../services/balance.service.js';

import {
  sendEmail,
  templates,
} from '../services/email.service.js';

import {
  emailAdmins,
} from '../services/notification.service.js';

const RESTORE_WINDOW_DAYS = 7;
const MAX_CSV_ROWS = 500;

const REQUIRED_CSV_COLUMNS = [
  'fullName',
  'email',
  'employeeId',
  'cnic',
  'role',
  'designation',
  'department',
  'grade',
  'dateOfJoining',
];

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CNIC_RE =
  /^\d{5}-\d{7}-\d$/;

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}$/;

/* =========================================================
   HELPERS
========================================================= */

function buildEmployeeFilter(
  query,
  currentUser
) {
  const filter = {};

  if (
    currentUser.role ===
    'manager'
  ) {
    filter.$or = [
      {
        managerId:
          currentUser._id,
      },
      {
        department:
          currentUser.department,
      },
    ];
  } else if (
    currentUser.role ===
    'employee'
  ) {
    filter._id =
      currentUser._id;
  }

  if (query.department) {
    filter.department =
      query.department;
  }

  if (query.designation) {
    filter.designation =
      query.designation;
  }

  if (query.role) {
    filter.role =
      query.role;
  }

  if (query.status) {
    filter.status =
      query.status;
  } else {
    filter.status = {
      $ne:
        'pending_deletion',
    };
  }

  if (query.grade) {
    filter.gradeId =
      query.grade;
  }

  if (
    query.search ||
    query.employeeName
  ) {
    const term =
      query.search ||
      query.employeeName;

    filter.fullName = {
      $regex: term,
      $options: 'i',
    };
  }

  return filter;
}

function clean(value) {
  return String(
    value ?? ''
  ).trim();
}

function normalize(value) {
  return clean(
    value
  ).toLowerCase();
}

function isValidDateOnly(
  value
) {
  const text =
    clean(value);

  if (!DATE_RE.test(text)) {
    return false;
  }

  const [
    year,
    month,
    day,
  ] = text
    .split('-')
    .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  return (
    date.getUTCFullYear() ===
      year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() ===
      day
  );
}

function formatCsvErrors(
  errors
) {
  const visible =
    errors.slice(0, 20);

  const lines =
    visible.map(
      (error) =>
        `Row ${error.row}: ${error.reason}`
    );

  if (
    errors.length >
    visible.length
  ) {
    lines.push(
      `...and ${
        errors.length -
        visible.length
      } more error(s).`
    );
  }

  return [
    'CSV validation failed.',
    ...lines,
  ].join('\n');
}

/* =========================================================
   EMPLOYEE LIST
========================================================= */

export const listEmployees =
  asyncHandler(
    async (req, res) => {
      const {
        page,
        limit,
        skip,
      } = getPagination(
        req.query
      );

      const filter =
        buildEmployeeFilter(
          req.query,
          req.currentUser
        );

      const [
        users,
        total,
      ] =
        await Promise.all([
          User.find(
            filter
          )
            .populate(
              'gradeId'
            )
            .sort({
              fullName: 1,
            })
            .skip(skip)
            .limit(limit),

          User.countDocuments(
            filter
          ),
        ]);

      res.json({
        success: true,

        ...paginated(
          users.map(
            sanitizeUser
          ),
          total,
          {
            page,
            limit,
          }
        ),
      });
    }
  );

/* =========================================================
   GET CURRENT USER
========================================================= */

export const getMe =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(
          req.user.id
        ).populate(
          'gradeId'
        );

      if (!user) {
        throw new NotFoundError();
      }

      const balances =
        await getLeaveBalancesForUser(
          user._id
        );

      res.json({
        success: true,

        data: {
          ...sanitizeUser(
            user
          ),

          balances,
        },
      });
    }
  );

/* =========================================================
   GET EMPLOYEE
========================================================= */

export const getEmployee =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(
          req.params.id
        ).populate(
          'gradeId'
        );

      if (!user) {
        throw new NotFoundError();
      }

      if (
        req.currentUser
          .role ===
          'employee' &&
        String(
          user._id
        ) !==
          String(
            req.currentUser
              ._id
          )
      ) {
        throw new NotFoundError();
      }

      const balances =
        await getLeaveBalancesForUser(
          user._id
        );

      res.json({
        success: true,

        data: {
          ...sanitizeUser(
            user
          ),

          balances,
        },
      });
    }
  );

/* =========================================================
   CREATE EMPLOYEE
========================================================= */

export const createEmployee =
  asyncHandler(
    async (req, res) => {
      const body =
        req.body;

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

      if (
        missing.length
      ) {
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
        !EMAIL_RE.test(
          normalize(
            body.email
          )
        )
      ) {
        throw new ValidationError(
          'Invalid email format.'
        );
      }

      if (
        !CNIC_RE.test(
          clean(
            body.cnic
          )
        )
      ) {
        throw new ValidationError(
          'Invalid CNIC format. Use 12345-1234567-1.'
        );
      }

      if (
        ![
          'employee',
          'manager',
        ].includes(
          normalize(
            body.role
          )
        )
      ) {
        throw new ValidationError(
          'Role must be employee or manager.'
        );
      }

      if (
        !isValidDateOnly(
          body.dateOfJoining
        )
      ) {
        throw new ValidationError(
          'Invalid date of joining. Use YYYY-MM-DD.'
        );
      }

      const duplicate =
        await User.findOne({
          $or: [
            {
              email:
                normalize(
                  body.email
                ),
            },

            {
              nationalId:
                clean(
                  body.cnic
                ),
            },

            {
              cnic:
                clean(
                  body.cnic
                ),
            },

            {
              employeeId:
                clean(
                  body.employeeId
                ),
            },
          ],
        });

      if (duplicate) {
        throw new ConflictError(
          'An employee with that email, CNIC or Employee ID already exists.'
        );
      }

      const [
        grade,
        department,
        designation,
      ] =
        await Promise.all([
          Grade.findById(
            body.gradeId
          ),

          Department.findOne({
            name: {
              $regex:
                `^${clean(
                  body.department
                ).replace(
                  /[.*+?^${}()|[\]\\]/g,
                  '\\$&'
                )}$`,

              $options: 'i',
            },
          }),

          Designation.findOne({
            name: {
              $regex:
                `^${clean(
                  body.designation
                ).replace(
                  /[.*+?^${}()|[\]\\]/g,
                  '\\$&'
                )}$`,

              $options: 'i',
            },
          }),
        ]);

      if (!grade) {
        throw new ValidationError(
          'Selected grade does not exist in Master Data.'
        );
      }

      if (!department) {
        throw new ValidationError(
          'Selected department does not exist in Master Data.'
        );
      }

      if (!designation) {
        throw new ValidationError(
          'Selected designation does not exist in Master Data.'
        );
      }

      const user =
        await User.create({
          fullName:
            clean(
              body.fullName
            ),

          email:
            normalize(
              body.email
            ),

          nationalId:
            clean(
              body.cnic
            ),

          cnic:
            clean(
              body.cnic
            ),

          passwordHash:
            await bcrypt.hash(
              clean(
                body.cnic
              ),
              10
            ),

          role:
            normalize(
              body.role
            ),

          gradeId:
            grade._id,

          managerId:
            body.managerId ||
            null,

          canApproveOtherDepartments:
            normalize(
              body.role
            ) ===
            'manager'
              ? Boolean(
                  body.canApproveOtherDepartments
                )
              : false,

          employeeId:
            clean(
              body.employeeId
            ),

          designation:
            designation.name,

          department:
            department.name,

          phone:
            clean(
              body.phone
            ) ||
            undefined,

          dateOfJoining:
            new Date(
              `${body.dateOfJoining}T00:00:00.000Z`
            ),

          profilePhotoUrl:
            body.profilePhotoUrl,
        });

      await initializeLeaveBalances(
        user._id,
        grade
      );

      try {
        await sendEmail({
          to: user.email,

          subject:
            'Your Leave Management account is ready',

          html:
            templates.accountCreated(
              user
            ),
        });
      } catch (
        emailError
      ) {
        console.error(
          'Employee account email failed:',
          emailError
        );
      }

      await audit({
        actorId:
          req.currentUser
            ._id,

        actorName:
          req.currentUser
            .fullName,

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
          `Created employee ${user.fullName} (${user.employeeId})`,
      });

      const populatedUser =
        await User.findById(
          user._id
        ).populate(
          'gradeId'
        );

      res
        .status(201)
        .json({
          success: true,

          data:
            sanitizeUser(
              populatedUser
            ),
        });
    }
  );

/* =========================================================
   UPDATE EMPLOYEE
========================================================= */

export const updateEmployee =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        throw new NotFoundError();
      }

      if (
        req.body.email !==
        undefined
      ) {
        const email =
          normalize(
            req.body.email
          );

        if (
          !EMAIL_RE.test(
            email
          )
        ) {
          throw new ValidationError(
            'Invalid email format.'
          );
        }

        const duplicateEmail =
          await User.findOne({
            email,

            _id: {
              $ne:
                user._id,
            },
          });

        if (
          duplicateEmail
        ) {
          throw new ConflictError(
            'Another employee already uses this email.'
          );
        }
      }

      if (
        req.body.employeeId !==
        undefined
      ) {
        const employeeId =
          clean(
            req.body.employeeId
          );

        const duplicateEmployeeId =
          await User.findOne({
            employeeId,

            _id: {
              $ne:
                user._id,
            },
          });

        if (
          duplicateEmployeeId
        ) {
          throw new ConflictError(
            'Another employee already uses this Employee ID.'
          );
        }
      }

      if (
        req.body.role !==
        undefined &&
        ![
          'employee',
          'manager',
        ].includes(
          normalize(
            req.body.role
          )
        )
      ) {
        throw new ValidationError(
          'Role must be employee or manager.'
        );
      }

      if (
        req.body.dateOfJoining !==
          undefined &&
        !isValidDateOnly(
          req.body.dateOfJoining
        )
      ) {
        throw new ValidationError(
          'Invalid date of joining. Use YYYY-MM-DD.'
        );
      }

      if (
        req.body.gradeId
      ) {
        const grade =
          await Grade.findById(
            req.body.gradeId
          );

        if (!grade) {
          throw new ValidationError(
            'Selected grade does not exist.'
          );
        }
      }

      if (
        req.body.department
      ) {
        const department =
          await Department.findOne({
            name:
              req.body.department,
          });

        if (!department) {
          throw new ValidationError(
            'Selected department does not exist in Master Data.'
          );
        }
      }

      if (
        req.body.designation
      ) {
        const designation =
          await Designation.findOne({
            name:
              req.body.designation,
          });

        if (!designation) {
          throw new ValidationError(
            'Selected designation does not exist in Master Data.'
          );
        }
      }

      const editable = [
        'fullName',
        'email',
        'role',
        'gradeId',
        'managerId',
        'canApproveOtherDepartments',
        'employeeId',
        'designation',
        'department',
        'phone',
        'dateOfJoining',
        'status',
        'profilePhotoUrl',
      ];

      const changed = [];

      for (
        const field
        of editable
      ) {
        if (
          req.body[
            field
          ] === undefined
        ) {
          continue;
        }

        if (
          field ===
          'email'
        ) {
          user.email =
            normalize(
              req.body.email
            );
        } else if (
          field ===
          'dateOfJoining'
        ) {
          user.dateOfJoining =
            new Date(
              `${req.body.dateOfJoining}T00:00:00.000Z`
            );
        } else if (
          field ===
          'status'
        ) {
          if (
            req.body
              .status ===
            'pending_deletion'
          ) {
            continue;
          }

          user.status =
            req.body.status;
        } else {
          user[field] =
            req.body[
              field
            ];
        }

        changed.push(
          field
        );
      }

      if (
        user.role !==
        'manager'
      ) {
        user.canApproveOtherDepartments =
          false;
      }

      await user.save();

      if (
        changed.includes(
          'gradeId'
        )
      ) {
        const grade =
          await Grade.findById(
            user.gradeId
          );

        if (grade) {
          await syncQuotasToGrade(
            user._id,
            grade
          );
        }
      }

      await audit({
        actorId:
          req.currentUser
            ._id,

        actorName:
          req.currentUser
            .fullName,

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
          `Updated ${
            changed.join(
              ', '
            ) ||
            'nothing'
          }`,
      });

      const populatedUser =
        await User.findById(
          user._id
        ).populate(
          'gradeId'
        );

      res.json({
        success: true,

        data:
          sanitizeUser(
            populatedUser
          ),
      });
    }
  );

/* =========================================================
   SOFT REMOVE EMPLOYEE
========================================================= */

export const removeEmployee =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        throw new NotFoundError();
      }

      if (
        String(
          user._id
        ) ===
        String(
          req.currentUser
            ._id
        )
      ) {
        throw new ValidationError(
          'You cannot remove your own account.'
        );
      }

      const now =
        new Date();

      user.status =
        'pending_deletion';

      user.deactivatedAt =
        now;

      user.scheduledPurgeAt =
        new Date(
          now.getTime() +
            RESTORE_WINDOW_DAYS *
              24 *
              60 *
              60 *
              1000
        );

      user.removedBy =
        req.currentUser
          ._id;

      user.refreshTokenHash =
        null;

      await user.save();

      const cancelled =
        await LeaveRequest.updateMany(
          {
            employeeId:
              user._id,

            status:
              'pending',
          },

          {
            $set: {
              status:
                'cancelled',

              cancelledBy:
                req.currentUser
                  ._id,

              cancelledByName:
                req.currentUser
                  .fullName,

              cancelledReason:
                'Employee removed',
            },

            $push: {
              approvalHistory:
                {
                  approverId:
                    req.currentUser
                      ._id,

                  approverName:
                    req.currentUser
                      .fullName,

                  approverRole:
                    req.currentUser
                      .role,

                  action:
                    'cancelled',

                  comment:
                    'Auto-cancelled: employee removed',
                },
            },
          }
        );

      await audit({
        actorId:
          req.currentUser
            ._id,

        actorName:
          req.currentUser
            .fullName,

        action:
          'REMOVE_EMPLOYEE',

        targetType:
          'User',

        targetId:
          user._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        details:
          `Removed ${user.fullName}; ${cancelled.modifiedCount} pending request(s) auto-cancelled. Restorable until ${user.scheduledPurgeAt.toISOString()}`,
      });

      try {
        await emailAdmins(
          'Employee removed',

          `${user.fullName} (${user.employeeId}) was removed by ${req.currentUser.fullName}. They can be restored until ${user.scheduledPurgeAt.toDateString()}.`
        );
      } catch (
        emailError
      ) {
        console.error(
          'Employee removal email failed:',
          emailError
        );
      }

      res.json({
        success: true,

        data:
          sanitizeUser(
            user
          ),
      });
    }
  );

/* =========================================================
   RESTORE EMPLOYEE
========================================================= */

export const restoreEmployee =
  asyncHandler(
    async (req, res) => {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        throw new NotFoundError();
      }

      if (
        user.status !==
        'pending_deletion'
      ) {
        throw new ValidationError(
          'This employee is not pending deletion.'
        );
      }

      if (
        user.scheduledPurgeAt &&
        new Date() >
          user.scheduledPurgeAt
      ) {
        throw new ValidationError(
          'The restore window has expired.'
        );
      }

      user.status =
        'active';

      user.deactivatedAt =
        null;

      user.scheduledPurgeAt =
        null;

      user.removedBy =
        null;

      await user.save();

      await audit({
        actorId:
          req.currentUser
            ._id,

        actorName:
          req.currentUser
            .fullName,

        action:
          'RESTORE_EMPLOYEE',

        targetType:
          'User',

        targetId:
          user._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        details:
          `Restored ${user.fullName} within the ${RESTORE_WINDOW_DAYS}-day window`,
      });

      try {
        await emailAdmins(
          'Employee restored',

          `${user.fullName} (${user.employeeId}) was restored by ${req.currentUser.fullName}.`
        );
      } catch (
        emailError
      ) {
        console.error(
          'Employee restore email failed:',
          emailError
        );
      }

      res.json({
        success: true,

        data:
          sanitizeUser(
            user
          ),
      });
    }
  );

/* =========================================================
   LIST REMOVED EMPLOYEES
========================================================= */

export const listRemovedEmployees =
  asyncHandler(
    async (req, res) => {
      const {
        page,
        limit,
        skip,
      } = getPagination(
        req.query
      );

      const filter = {
        status:
          'pending_deletion',
      };

      const [
        users,
        total,
      ] =
        await Promise.all([
          User.find(
            filter
          )
            .populate(
              'gradeId'
            )
            .sort({
              scheduledPurgeAt: 1,
            })
            .skip(skip)
            .limit(limit),

          User.countDocuments(
            filter
          ),
        ]);

      const now =
        Date.now();

      const data =
        users.map(
          (user) => {
            const msRemaining =
              user.scheduledPurgeAt
                ? user.scheduledPurgeAt.getTime() -
                  now
                : 0;

            return {
              ...sanitizeUser(
                user
              ),

              timeRemaining:
                {
                  msRemaining:
                    Math.max(
                      0,
                      msRemaining
                    ),

                  daysRemaining:
                    Math.max(
                      0,
                      Math.ceil(
                        msRemaining /
                          86400000
                      )
                    ),

                  purgesAt:
                    user.scheduledPurgeAt,
                },
            };
          }
        );

      res.json({
        success: true,

        ...paginated(
          data,
          total,
          {
            page,
            limit,
          }
        ),
      });
    }
  );

/* =========================================================
   CSV EXPORT
========================================================= */

export const exportEmployeesCsv =
  asyncHandler(
    async (req, res) => {
      const users =
        await User.find({
          role: {
            $ne: 'admin',
          },

          status: {
            $ne:
              'pending_deletion',
          },
        }).populate(
          'gradeId'
        );

      const leaveTypes =
  (
    await LeavePolicy.distinct(
      'leaveType'
    )
  ).sort();

      const rows =
        await Promise.all(
          users.map(
            async (user) => {
              const balances =
                await getLeaveBalancesForUser(
                  user._id
                );

              const row = {
                fullName:
                  user.fullName,

                email:
                  user.email,

                employeeId:
                  user.employeeId,

                cnic:
                  user.cnic,

                role:
                  user.role,

                designation:
                  user.designation,

                department:
                  user.department,

                grade:
                  user.gradeId
                    ?.name ||
                  '',

                dateOfJoining:
                  user.dateOfJoining
                    ? user.dateOfJoining
                        .toISOString()
                        .split(
                          'T'
                        )[0]
                    : '',

                status:
                  user.status,

                canApproveOtherDepartments:
                  user.role ===
                  'manager'
                    ? user.canApproveOtherDepartments
                    : '',

                phone:
                  user.phone ||
                  '',
              };

              for (
                const type
                of leaveTypes
              ) {
                const balance =
                  balances[
                    type
                  ] || {
                    quota: 0,
                    used: 0,
                    remaining: 0,
                  };

                row[
                  `${type}Granted`
                ] =
                  balance.quota;

                row[
                  `${type}Used`
                ] =
                  balance.used;

                row[
                  `${type}Remaining`
                ] =
                  balance.remaining;
              }

              return row;
            }
          )
        );

      const parser =
        new Parser();

      const csv =
        parser.parse(
          rows
        );

      res.header(
        'Content-Type',
        'text/csv'
      );

      res.attachment(
        `employees-export-${Date.now()}.csv`
      );

      res.send(csv);
    }
  );

/* =========================================================
   STRICT CSV IMPORT

   RESTRICTIONS:
   - CSV only
   - upload middleware max file size
   - max 500 rows
   - required headers
   - required values
   - valid email
   - valid CNIC
   - valid joining date
   - role only employee/manager
   - NO admin import
   - duplicate email blocked
   - duplicate CNIC blocked
   - duplicate Employee ID blocked
   - duplicate rows inside same CSV blocked
   - Grade must already exist
   - Department must already exist
   - Designation must already exist
   - CSV cannot create Master Data
========================================================= */

export const importEmployeesCsv =
  asyncHandler(
    async (req, res) => {
      if (!req.file) {
        throw new ValidationError(
          'A CSV file is required.'
        );
      }

      let rows;

      try {
        rows = parse(
          req.file.buffer,
          {
            columns: true,

            skip_empty_lines:
              true,

            trim: true,

            bom: true,
          }
        );
      } catch (error) {
        throw new ValidationError(
          `Unable to read CSV file: ${error.message}`
        );
      }

      if (
        !Array.isArray(
          rows
        ) ||
        rows.length === 0
      ) {
        throw new ValidationError(
          'CSV file does not contain any employee rows.'
        );
      }

      if (
        rows.length >
        MAX_CSV_ROWS
      ) {
        throw new ValidationError(
          `Maximum ${MAX_CSV_ROWS} employees are allowed in one CSV file. This file contains ${rows.length} rows.`
        );
      }

      const headers =
        Object.keys(
          rows[0] || {}
        );

      const missingColumns =
        REQUIRED_CSV_COLUMNS.filter(
          (column) =>
            !headers.includes(
              column
            )
        );

      if (
        missingColumns.length
      ) {
        throw new ValidationError(
          `Missing required CSV column(s): ${missingColumns.join(', ')}`
        );
      }

      const [
        departments,
        designations,
        grades,
      ] =
        await Promise.all([
          Department.find(
            {}
          ).lean(),

          Designation.find(
            {}
          ).lean(),

          Grade.find(
            {}
          ).lean(),
        ]);

      const departmentMap =
        new Map(
          departments.map(
            (item) => [
              normalize(
                item.name
              ),

              item,
            ]
          )
        );

      const designationMap =
        new Map(
          designations.map(
            (item) => [
              normalize(
                item.name
              ),

              item,
            ]
          )
        );

      const gradeMap =
        new Map(
          grades.map(
            (item) => [
              normalize(
                item.name
              ),

              item,
            ]
          )
        );

      const errors = [];

      const seenEmails =
        new Map();

      const seenCnics =
        new Map();

      const seenEmployeeIds =
        new Map();

      const normalizedRows =
        rows.map(
          (
            row,
            index
          ) => {
            /*
             * Row 1 is CSV header,
             * therefore first data
             * row is Row 2.
             */
            const rowNumber =
              index + 2;

            const normalizedRow =
              {
                rowNumber,

                fullName:
                  clean(
                    row.fullName
                  ),

                email:
                  normalize(
                    row.email
                  ),

                employeeId:
                  clean(
                    row.employeeId
                  ),

                cnic:
                  clean(
                    row.cnic
                  ),

                role:
                  normalize(
                    row.role
                  ),

                designation:
                  clean(
                    row.designation
                  ),

                department:
                  clean(
                    row.department
                  ),

                grade:
                  clean(
                    row.grade
                  ),

                dateOfJoining:
                  clean(
                    row.dateOfJoining
                  ),

                phone:
                  clean(
                    row.phone
                  ),
              };

            /*
             * Required values
             */
            for (
              const column
              of REQUIRED_CSV_COLUMNS
            ) {
              if (
                !normalizedRow[
                  column
                ]
              ) {
                errors.push({
                  row:
                    rowNumber,

                  reason:
                    `${column} is required.`,
                });
              }
            }

            /*
             * Email
             */
            if (
              normalizedRow.email &&
              !EMAIL_RE.test(
                normalizedRow.email
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Invalid email "${normalizedRow.email}".`,
              });
            }

            /*
             * CNIC
             */
            if (
              normalizedRow.cnic &&
              !CNIC_RE.test(
                normalizedRow.cnic
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Invalid CNIC "${normalizedRow.cnic}". Expected format 12345-1234567-1.`,
              });
            }

            /*
             * Date
             */
            if (
              normalizedRow.dateOfJoining &&
              !isValidDateOnly(
                normalizedRow.dateOfJoining
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Invalid dateOfJoining "${normalizedRow.dateOfJoining}". Use YYYY-MM-DD.`,
              });
            }

            /*
             * Role restriction
             */
            if (
              normalizedRow.role &&
              ![
                'employee',
                'manager',
              ].includes(
                normalizedRow.role
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Role "${normalizedRow.role}" is not allowed. Only employee or manager can be imported.`,
              });
            }

            /*
             * Department must
             * already exist.
             */
            if (
              normalizedRow.department &&
              !departmentMap.has(
                normalize(
                  normalizedRow.department
                )
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Department "${normalizedRow.department}" does not exist in Master Data.`,
              });
            }

            /*
             * Designation must
             * already exist.
             */
            if (
              normalizedRow.designation &&
              !designationMap.has(
                normalize(
                  normalizedRow.designation
                )
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Designation "${normalizedRow.designation}" does not exist in Master Data.`,
              });
            }

            /*
             * Grade must
             * already exist.
             */
            if (
              normalizedRow.grade &&
              !gradeMap.has(
                normalize(
                  normalizedRow.grade
                )
              )
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Grade "${normalizedRow.grade}" does not exist in Master Data.`,
              });
            }

            /*
             * Duplicate email
             * inside CSV
             */
            const previousEmailRow =
              seenEmails.get(
                normalizedRow.email
              );

            if (
              normalizedRow.email &&
              previousEmailRow
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Duplicate email "${normalizedRow.email}" inside CSV. Already used on row ${previousEmailRow}.`,
              });
            } else if (
              normalizedRow.email
            ) {
              seenEmails.set(
                normalizedRow.email,
                rowNumber
              );
            }

            /*
             * Duplicate CNIC
             * inside CSV
             */
            const previousCnicRow =
              seenCnics.get(
                normalizedRow.cnic
              );

            if (
              normalizedRow.cnic &&
              previousCnicRow
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Duplicate CNIC "${normalizedRow.cnic}" inside CSV. Already used on row ${previousCnicRow}.`,
              });
            } else if (
              normalizedRow.cnic
            ) {
              seenCnics.set(
                normalizedRow.cnic,
                rowNumber
              );
            }

            /*
             * Employee ID is
             * case-insensitive
             * for CSV duplicate
             * checking.
             */
            const employeeIdKey =
              normalize(
                normalizedRow.employeeId
              );

            const previousEmployeeIdRow =
              seenEmployeeIds.get(
                employeeIdKey
              );

            if (
              employeeIdKey &&
              previousEmployeeIdRow
            ) {
              errors.push({
                row:
                  rowNumber,

                reason:
                  `Duplicate Employee ID "${normalizedRow.employeeId}" inside CSV. Already used on row ${previousEmployeeIdRow}.`,
              });
            } else if (
              employeeIdKey
            ) {
              seenEmployeeIds.set(
                employeeIdKey,
                rowNumber
              );
            }

            return normalizedRow;
          }
        );

      /*
       * Only query DB duplicates
       * if basic CSV validation
       * passed.
       */
      if (
        errors.length === 0
      ) {
        const emails =
          normalizedRows.map(
            (row) =>
              row.email
          );

        const cnics =
          normalizedRows.map(
            (row) =>
              row.cnic
          );

        const employeeIds =
          normalizedRows.map(
            (row) =>
              row.employeeId
          );

        const existingUsers =
          await User.find({
            $or: [
              {
                email: {
                  $in: emails,
                },
              },

              {
                nationalId: {
                  $in: cnics,
                },
              },

              {
                cnic: {
                  $in: cnics,
                },
              },

              {
                employeeId: {
                  $in:
                    employeeIds,
                },
              },
            ],
          })
            .select(
              'email nationalId cnic employeeId'
            )
            .lean();

        const existingEmailSet =
          new Set(
            existingUsers.map(
              (user) =>
                normalize(
                  user.email
                )
            )
          );

        const existingCnicSet =
          new Set(
            existingUsers.flatMap(
              (user) => [
                clean(
                  user.nationalId
                ),

                clean(
                  user.cnic
                ),
              ]
            )
          );

        const existingEmployeeIdSet =
          new Set(
            existingUsers.map(
              (user) =>
                normalize(
                  user.employeeId
                )
            )
          );

        for (
          const row
          of normalizedRows
        ) {
          if (
            existingEmailSet.has(
              row.email
            )
          ) {
            errors.push({
              row:
                row.rowNumber,

              reason:
                `Email "${row.email}" already exists in the database.`,
            });
          }

          if (
            existingCnicSet.has(
              row.cnic
            )
          ) {
            errors.push({
              row:
                row.rowNumber,

              reason:
                `CNIC "${row.cnic}" already exists in the database.`,
            });
          }

          if (
            existingEmployeeIdSet.has(
              normalize(
                row.employeeId
              )
            )
          ) {
            errors.push({
              row:
                row.rowNumber,

              reason:
                `Employee ID "${row.employeeId}" already exists in the database.`,
            });
          }
        }
      }

      /*
       * STOP entire import.
       *
       * No employees have
       * been created yet.
       */
      if (
        errors.length
      ) {
        throw new ValidationError(
          formatCsvErrors(
            errors
          ),

          {
            csvErrors:
              errors,
          }
        );
      }

      /*
       * Every CSV row is valid
       * at this point.
       */
      const createdUsers =
        [];

      try {
        for (
          const row
          of normalizedRows
        ) {
          const department =
            departmentMap.get(
              normalize(
                row.department
              )
            );

          const designation =
            designationMap.get(
              normalize(
                row.designation
              )
            );

          const grade =
            gradeMap.get(
              normalize(
                row.grade
              )
            );

          const newUser =
            await User.create({
              fullName:
                row.fullName,

              email:
                row.email,

              nationalId:
                row.cnic,

              cnic:
                row.cnic,

              passwordHash:
                await bcrypt.hash(
                  row.cnic,
                  10
                ),

              role:
                row.role,

              designation:
                designation.name,

              department:
                department.name,

              gradeId:
                grade._id,

              employeeId:
                row.employeeId,

              phone:
                row.phone ||
                undefined,

              dateOfJoining:
                new Date(
                  `${row.dateOfJoining}T00:00:00.000Z`
                ),

              managerId:
                null,

              canApproveOtherDepartments:
                false,
            });

          await initializeLeaveBalances(
            newUser._id,
            grade
          );

          createdUsers.push(
            newUser
          );
        }
      } catch (
        creationError
      ) {
        /*
         * Validation was atomic,
         * but a DB/server failure
         * during creation could
         * theoretically happen
         * after some rows.
         *
         * Roll back users created
         * during this import.
         */
        if (
          createdUsers.length >
          0
        ) {
          const ids =
            createdUsers.map(
              (user) =>
                user._id
            );

          await User.deleteMany({
            _id: {
              $in: ids,
            },
          });
        }

        throw creationError;
      }

      await audit({
        actorId:
          req.currentUser
            ._id,

        actorName:
          req.currentUser
            .fullName,

        action:
          'IMPORT_EMPLOYEES',

        targetType:
          'BulkImport',

        details:
          `Imported ${createdUsers.length} employee(s). Strict validation passed. No Master Data records were auto-created.`,
      });

      res.json({
        success: true,

        created:
          createdUsers.length,

        message:
          `${createdUsers.length} employee(s) imported successfully.`,

        restrictions: {
          maxRows:
            MAX_CSV_ROWS,

          masterDataAutoCreate:
            false,

          allowedRoles: [
            'employee',
            'manager',
          ],
        },
      });
    }
  );