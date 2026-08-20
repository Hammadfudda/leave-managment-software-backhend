import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import User from '../models/User.js';
import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import LeaveBalance from '../models/LeaveBalance.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

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

const MAX_CSV_ROWS = 500;

const REQUIRED_HEADERS = [
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

const HARD_REQUIRED = [
  'fullName',
  'email',
  'employeeId',
  'role',
];

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CNIC_RE =
  /^\d{5}-\d{7}-\d$/;

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}$/;

const clean = (value) =>
  String(value ?? '').trim();

const normalize = (value) =>
  clean(value).toLowerCase();

function isValidDate(
  value
) {
  const text =
    clean(value);

  if (
    !DATE_RE.test(text)
  ) {
    return false;
  }

  const [
    year,
    month,
    day,
  ] =
    text
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

function addHardIssue(
  row,
  field,
  message
) {
  row.hardIssues.push({
    field,
    message,
  });
}

function addPendingIssue(
  row,
  field,
  message,
  currentValue = ''
) {
  row.pendingIssues.push({
    field,
    message,
    currentValue,
  });

  if (
    !row.pendingFields.includes(
      field
    )
  ) {
    row.pendingFields.push(
      field
    );
  }
}

async function getMasterData() {
  const [
    departments,
    designations,
    grades,
  ] =
    await Promise.all([
      Department.find({}).lean(),
      Designation.find({}).lean(),
      Grade.find({}).lean(),
    ]);

  return {
    departmentMap:
      new Map(
        departments.map(
          (item) => [
            normalize(item.name),
            item,
          ]
        )
      ),

    designationMap:
      new Map(
        designations.map(
          (item) => [
            normalize(item.name),
            item,
          ]
        )
      ),

    gradeMap:
      new Map(
        grades.map(
          (item) => [
            normalize(item.name),
            item,
          ]
        )
      ),
  };
}

/*
|--------------------------------------------------------------------------
| CSV PREVIEW + COMMIT
|--------------------------------------------------------------------------
|
| preview:
|   - Nothing is inserted.
|   - Hard errors block import.
|   - Correctable employee-detail problems are returned as pending.
|
| commit:
|   - Complete rows are inserted normally.
|   - Correctable rows are inserted with detailsStatus='pending'.
|   - No Department / Designation / Grade is auto-created.
|
*/
export const importEmployeesCsvPending =
  asyncHandler(
    async (
      req,
      res
    ) => {
      if (!req.file) {
        throw new ValidationError(
          'A CSV file is required.'
        );
      }

      const mode =
        normalize(
          req.query.mode ||
            'preview'
        );

      if (
        ![
          'preview',
          'commit',
        ].includes(mode)
      ) {
        throw new ValidationError(
          'mode must be preview or commit.'
        );
      }

      let rawRows;

      try {
        rawRows =
          parse(
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
          rawRows
        ) ||
        rawRows.length === 0
      ) {
        throw new ValidationError(
          'CSV file does not contain any employee rows.'
        );
      }

      if (
        rawRows.length >
        MAX_CSV_ROWS
      ) {
        throw new ValidationError(
          `Maximum ${MAX_CSV_ROWS} employees are allowed in one CSV file.`
        );
      }

      const headers =
        Object.keys(
          rawRows[0] ||
            {}
        );

      const missingHeaders =
        REQUIRED_HEADERS.filter(
          (header) =>
            !headers.includes(
              header
            )
        );

      if (
        missingHeaders.length
      ) {
        throw new ValidationError(
          `Missing required CSV column(s): ${missingHeaders.join(', ')}`
        );
      }

      const {
        departmentMap,
        designationMap,
        gradeMap,
      } =
        await getMasterData();

      const seenEmails =
        new Map();

      const seenEmployeeIds =
        new Map();

      const seenCnics =
        new Map();

      const prepared =
        rawRows.map(
          (
            raw,
            index
          ) => {
            const row = {
              rowNumber:
                index + 2,

              fullName:
                clean(
                  raw.fullName
                ),

              email:
                normalize(
                  raw.email
                ),

              employeeId:
                clean(
                  raw.employeeId
                ),

              cnic:
                clean(
                  raw.cnic
                ),

              role:
                normalize(
                  raw.role
                ),

              designation:
                clean(
                  raw.designation
                ),

              department:
                clean(
                  raw.department
                ),

              grade:
                clean(
                  raw.grade
                ),

              dateOfJoining:
                clean(
                  raw.dateOfJoining
                ),

              phone:
                clean(
                  raw.phone
                ),

              hardIssues: [],
              pendingIssues: [],
              pendingFields: [],
            };

            for (
              const field
              of HARD_REQUIRED
            ) {
              if (
                !row[field]
              ) {
                addHardIssue(
                  row,
                  field,
                  `${field} is required.`
                );
              }
            }

            if (
              row.email &&
              !EMAIL_RE.test(
                row.email
              )
            ) {
              addHardIssue(
                row,
                'email',
                `Invalid email "${row.email}".`
              );
            }

            if (
              row.role &&
              ![
                'employee',
                'manager',
              ].includes(
                row.role
              )
            ) {
              addHardIssue(
                row,
                'role',
                `Role "${row.role}" is not allowed. Only employee or manager can be imported.`
              );
            }

            if (
              !row.cnic
            ) {
              addPendingIssue(
                row,
                'cnic',
                'CNIC is missing. Required format: 12345-1234567-1.'
              );
            } else if (
              !CNIC_RE.test(
                row.cnic
              )
            ) {
              addPendingIssue(
                row,
                'cnic',
                'Invalid CNIC. Required format: 12345-1234567-1.',
                row.cnic
              );
            }

            if (
              !row.department
            ) {
              addPendingIssue(
                row,
                'department',
                'Department is missing.'
              );
            } else if (
              !departmentMap.has(
                normalize(
                  row.department
                )
              )
            ) {
              addPendingIssue(
                row,
                'department',
                `Department "${row.department}" was not found in Master Data.`,
                row.department
              );
            }

            if (
              !row.designation
            ) {
              addPendingIssue(
                row,
                'designation',
                'Designation is missing.'
              );
            } else if (
              !designationMap.has(
                normalize(
                  row.designation
                )
              )
            ) {
              addPendingIssue(
                row,
                'designation',
                `Designation "${row.designation}" was not found in Master Data.`,
                row.designation
              );
            }

            if (
              !row.grade
            ) {
              addPendingIssue(
                row,
                'grade',
                'Grade is missing.'
              );
            } else if (
              !gradeMap.has(
                normalize(
                  row.grade
                )
              )
            ) {
              addPendingIssue(
                row,
                'grade',
                `Grade "${row.grade}" was not found in Master Data.`,
                row.grade
              );
            }

            if (
              !row.dateOfJoining
            ) {
              addPendingIssue(
                row,
                'dateOfJoining',
                'Date of joining is missing.'
              );
            } else if (
              !isValidDate(
                row.dateOfJoining
              )
            ) {
              addPendingIssue(
                row,
                'dateOfJoining',
                'Invalid date of joining. Use YYYY-MM-DD.',
                row.dateOfJoining
              );
            }

            // Existing Create Employee UI requires phone, so CSV missing phone is
            // also treated as a correctable pending detail.
            if (
              !row.phone
            ) {
              addPendingIssue(
                row,
                'phone',
                'Phone number is missing.'
              );
            }

            if (
              row.email
            ) {
              if (
                seenEmails.has(
                  row.email
                )
              ) {
                addHardIssue(
                  row,
                  'email',
                  `Duplicate email inside CSV. Already used on row ${seenEmails.get(row.email)}.`
                );
              } else {
                seenEmails.set(
                  row.email,
                  row.rowNumber
                );
              }
            }

            const employeeKey =
              normalize(
                row.employeeId
              );

            if (
              employeeKey
            ) {
              if (
                seenEmployeeIds.has(
                  employeeKey
                )
              ) {
                addHardIssue(
                  row,
                  'employeeId',
                  `Duplicate Employee ID inside CSV. Already used on row ${seenEmployeeIds.get(employeeKey)}.`
                );
              } else {
                seenEmployeeIds.set(
                  employeeKey,
                  row.rowNumber
                );
              }
            }

            if (
              row.cnic &&
              CNIC_RE.test(
                row.cnic
              )
            ) {
              if (
                seenCnics.has(
                  row.cnic
                )
              ) {
                addHardIssue(
                  row,
                  'cnic',
                  `Duplicate valid CNIC inside CSV. Already used on row ${seenCnics.get(row.cnic)}.`
                );
              } else {
                seenCnics.set(
                  row.cnic,
                  row.rowNumber
                );
              }
            }

            return row;
          }
        );

      const validEmails =
        prepared
          .map(
            (row) =>
              row.email
          )
          .filter(Boolean);

      const validEmployeeIds =
        prepared
          .map(
            (row) =>
              row.employeeId
          )
          .filter(Boolean);

      const validCnics =
        prepared
          .map(
            (row) =>
              row.cnic
          )
          .filter(
            (cnic) =>
              CNIC_RE.test(
                cnic
              )
          );

      const existing =
        await User.find({
          $or: [
            {
              email: {
                $in:
                  validEmails,
              },
            },
            {
              employeeId: {
                $in:
                  validEmployeeIds,
              },
            },
            {
              nationalId: {
                $in:
                  validCnics,
              },
            },
            {
              cnic: {
                $in:
                  validCnics,
              },
            },
          ],
        })
          .select(
            'email employeeId nationalId cnic'
          )
          .lean();

      const emailSet =
        new Set(
          existing.map(
            (user) =>
              normalize(
                user.email
              )
          )
        );

      const employeeIdSet =
        new Set(
          existing.map(
            (user) =>
              normalize(
                user.employeeId
              )
          )
        );

      const cnicSet =
        new Set(
          existing
            .flatMap(
              (user) => [
                clean(
                  user.nationalId
                ),
                clean(
                  user.cnic
                ),
              ]
            )
            .filter(Boolean)
        );

      for (
        const row
        of prepared
      ) {
        if (
          row.email &&
          emailSet.has(
            row.email
          )
        ) {
          addHardIssue(
            row,
            'email',
            `Email "${row.email}" already exists in the database.`
          );
        }

        if (
          row.employeeId &&
          employeeIdSet.has(
            normalize(
              row.employeeId
            )
          )
        ) {
          addHardIssue(
            row,
            'employeeId',
            `Employee ID "${row.employeeId}" already exists in the database.`
          );
        }

        if (
          row.cnic &&
          CNIC_RE.test(
            row.cnic
          ) &&
          cnicSet.has(
            row.cnic
          )
        ) {
          addHardIssue(
            row,
            'cnic',
            `CNIC "${row.cnic}" already exists in the database.`
          );
        }
      }

      const hardErrors =
        prepared.flatMap(
          (row) =>
            row.hardIssues.map(
              (issue) => ({
                row:
                  row.rowNumber,
                employee:
                  row.fullName ||
                  row.email ||
                  `Row ${row.rowNumber}`,
                ...issue,
              })
            )
        );

      if (
        hardErrors.length
      ) {
        return res
          .status(422)
          .json({
            success: false,
            hardValidationFailed:
              true,
            message:
              'CSV contains blocking errors. Fix these rows before importing.',
            hardErrors,
            summary: {
              total:
                prepared.length,
              blocking:
                new Set(
                  hardErrors.map(
                    (error) =>
                      error.row
                  )
                ).size,
            },
          });
      }

      const pendingEmployees =
        prepared
          .filter(
            (row) =>
              row.pendingIssues
                .length > 0
          )
          .map(
            (row) => ({
              row:
                row.rowNumber,
              fullName:
                row.fullName,
              employeeId:
                row.employeeId,
              issues:
                row.pendingIssues,
              pendingFields:
                row.pendingFields,
            })
          );

      const summary = {
        total:
          prepared.length,
        complete:
          prepared.length -
          pendingEmployees.length,
        pending:
          pendingEmployees.length,
      };

      if (
        mode ===
        'preview'
      ) {
        return res.json({
          success: true,
          preview: true,
          requiresConfirmation:
            pendingEmployees.length >
            0,
          summary,
          pendingEmployees,
        });
      }

      const createdUsers = [];

      try {
        for (
          const row
          of prepared
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

          const isPending =
            row.pendingFields
              .length > 0;

          const hasValidCnic =
            CNIC_RE.test(
              row.cnic
            );

          const uniqueToken =
            `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

          const temporarySecret =
            hasValidCnic
              ? row.cnic
              : `TEMP-${row.employeeId}-${uniqueToken}`;

          const nationalId =
            hasValidCnic
              ? row.cnic
              : `PENDING-${row.employeeId}-${uniqueToken}`;

          const newUser =
            await User.create({
              fullName:
                row.fullName,

              email:
                row.email,

              nationalId,

              cnic:
                hasValidCnic
                  ? row.cnic
                  : '',

              passwordHash:
                await bcrypt.hash(
                  temporarySecret,
                  10
                ),

              passwordChangedFromDefault:
                !hasValidCnic,

              role:
                row.role,

              designation:
                designation?.name ||
                '',

              department:
                department?.name ||
                '',

              gradeId:
                grade?._id ||
                null,

              employeeId:
                row.employeeId,

              phone:
                row.phone ||
                undefined,

              dateOfJoining:
                isValidDate(
                  row.dateOfJoining
                )
                  ? new Date(
                      `${row.dateOfJoining}T00:00:00.000Z`
                    )
                  : null,

              managerId:
                null,

              canApproveOtherDepartments:
                false,

              detailsStatus:
                isPending
                  ? 'pending'
                  : 'complete',

              pendingFields:
                row.pendingFields,
            });

          if (
            !isPending &&
            grade
          ) {
            await initializeLeaveBalances(
              newUser._id,
              grade
            );
          }

          createdUsers.push(
            newUser
          );
        }
      } catch (error) {
        if (
          createdUsers.length
        ) {
          const createdIds =
            createdUsers.map(
              (user) =>
                user._id
            );

          await Promise.all([
            User.deleteMany({
              _id: {
                $in:
                  createdIds,
              },
            }),

            LeaveBalance.deleteMany({
              employeeId: {
                $in:
                  createdIds,
              },
            }),
          ]);
        }

        throw error;
      }

      await audit({
        actorId:
          req.currentUser._id,
        actorName:
          req.currentUser.fullName,
        action:
          'IMPORT_EMPLOYEES',
        targetType:
          'BulkImport',
        details:
          `Imported ${createdUsers.length} employee(s): ${summary.complete} complete, ${summary.pending} pending. No Master Data records auto-created.`,
      });

      return res.json({
        success: true,
        preview: false,
        created:
          createdUsers.length,
        summary,
        pendingEmployees,
        message:
          `${createdUsers.length} employee(s) imported. ${summary.pending} marked Details Pending.`,
      });
    }
  );

/*
|--------------------------------------------------------------------------
| COMPLETE A PENDING CSV EMPLOYEE
|--------------------------------------------------------------------------
|
| Normal employee update remains in employee.controller.js and is untouched.
| Frontend first saves normal editable fields with the existing update endpoint,
| then calls this endpoint only for a pending CSV employee.
|
*/
export const completePendingEmployee =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        throw new ValidationError(
          'Employee does not exist.'
        );
      }

      if (
        user.role ===
        'admin'
      ) {
        throw new ValidationError(
          'Admin account cannot be completed through employee pending-details flow.'
        );
      }

      const cnic =
        clean(
          req.body.cnic
        );

      const pendingFields = [];

      if (
        !CNIC_RE.test(
          cnic
        )
      ) {
        pendingFields.push(
          'cnic'
        );
      }

      const [
        grade,
        department,
        designation,
      ] =
        await Promise.all([
          user.gradeId
            ? Grade.findById(
                user.gradeId
              )
            : null,

          user.department
            ? Department.findOne({
                name:
                  user.department,
              })
            : null,

          user.designation
            ? Designation.findOne({
                name:
                  user.designation,
              })
            : null,
        ]);

      if (!grade) {
        pendingFields.push(
          'grade'
        );
      }

      if (!department) {
        pendingFields.push(
          'department'
        );
      }

      if (!designation) {
        pendingFields.push(
          'designation'
        );
      }

      if (
        !user.dateOfJoining ||
        Number.isNaN(
          new Date(
            user.dateOfJoining
          ).getTime()
        )
      ) {
        pendingFields.push(
          'dateOfJoining'
        );
      }

      if (
        !clean(
          user.phone
        )
      ) {
        pendingFields.push(
          'phone'
        );
      }

      if (
        pendingFields.length
      ) {
        user.detailsStatus =
          'pending';

        user.pendingFields =
          pendingFields;

        await user.save();

        throw new ValidationError(
          `Employee still has pending detail(s): ${pendingFields.join(', ')}.`
        );
      }

      const duplicateCnic =
        await User.findOne({
          _id: {
            $ne:
              user._id,
          },

          $or: [
            {
              cnic,
            },
            {
              nationalId:
                cnic,
            },
          ],
        })
          .select(
            '_id'
          )
          .lean();

      if (
        duplicateCnic
      ) {
        throw new ConflictError(
          'Another employee already uses this CNIC.'
        );
      }

      const oldNationalId =
        clean(
          user.nationalId
        );

      const needsDefaultPasswordReset =
        oldNationalId.startsWith(
          'PENDING-'
        ) ||
        !CNIC_RE.test(
          clean(
            user.cnic
          )
        );

      user.cnic =
        cnic;

      user.nationalId =
        cnic;

      if (
        needsDefaultPasswordReset
      ) {
        user.passwordHash =
          await bcrypt.hash(
            cnic,
            10
          );

        user.passwordChangedFromDefault =
          false;
      }

      user.pendingFields =
        [];

      user.detailsStatus =
        'complete';

      await user.save();

      await initializeLeaveBalances(
        user._id,
        grade
      );

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
        details:
          `Completed pending employee details for ${user.fullName}.`,
      });

      const populated =
        await User.findById(
          user._id
        )
          .populate(
            'gradeId',
            'name'
          )
          .lean();

      return res.json({
        success: true,
        data:
          populated,
        message:
          'Employee details are complete.',
      });
    }
  );
