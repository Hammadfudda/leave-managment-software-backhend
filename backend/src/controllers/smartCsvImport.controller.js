import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import User from '../models/User.js';
import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import LeavePolicy from '../models/LeavePolicy.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  generateTemporaryPassword,
} from '../services/temporaryPassword.service.js';

import {
  createCredentialEmailJobs,
  scheduleCredentialEmailJobs,
  retryPendingCredentialEmailJobs,
} from '../services/qstashCredentialEmail.service.js';

import {
  syncCurrentYearBalancesForAllEmployees,
} from '../services/balance.service.js';

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CNIC_RE =
  /^\d{5}-\d{7}-\d$/;

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}$/;

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

function normalizeLeaveType(
  value
) {
  return clean(value)
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      '_'
    )
    .replace(
      /_+/g,
      '_'
    )
    .replace(
      /^_|_$/g,
      ''
    );
}

function parseBool(
  value,
  defaultValue = false
) {
  const text =
    normalize(value);

  if (
    [
      'paid',
      'yes',
      'true',
      '1',
      'y',
    ].includes(text)
  ) {
    return true;
  }

  if (
    [
      'unpaid',
      'no',
      'false',
      '0',
      'n',
    ].includes(text)
  ) {
    return false;
  }

  return defaultValue;
}

function parseRows(
  file
) {
  if (!file) {
    throw new ValidationError(
      'A CSV file is required.'
    );
  }

  let rows;

  try {
    rows =
      parse(
        file.buffer,
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
    !rows.length
  ) {
    throw new ValidationError(
      'CSV file does not contain employee rows.'
    );
  }

  if (
    rows.length >
    500
  ) {
    throw new ValidationError(
      'Maximum 500 employee rows are allowed in one Smart CSV import.'
    );
  }

  return rows;
}

function managerReference(
  row
) {
  return clean(
    getField(
      row,
      'managerEmail',
      'manager',
      'managerName',
      'reportingManager',
      'reportingTo'
    )
  );
}

function dateIsValid(
  value
) {
  if (
    !ISO_DATE_RE.test(
      value
    )
  ) {
    return false;
  }

  const date =
    new Date(
      `${value}T00:00:00.000Z`
    );

  return (
    !Number.isNaN(
      date.getTime()
    ) &&
    date
      .toISOString()
      .slice(
        0,
        10
      ) === value
  );
}

function addDuplicateErrors(
  rows,
  field,
  label,
  normalizer = normalize
) {
  const seen =
    new Map();

  for (
    const row of
    rows
  ) {
    const value =
      normalizer(
        row[field]
      );

    if (!value) {
      continue;
    }

    if (
      seen.has(value)
    ) {
      const first =
        seen.get(
          value
        );

      row.errors.push(
        `${label} is duplicated in this CSV (also row ${first}).`
      );

      const firstRow =
        rows.find(
          (candidate) =>
            candidate.rowNumber ===
            first
        );

      if (
        firstRow &&
        !firstRow.errors.some(
          (message) =>
            message.includes(
              `${label} is duplicated`
            )
        )
      ) {
        firstRow.errors.push(
          `${label} is duplicated in this CSV (also row ${row.rowNumber}).`
        );
      }
    } else {
      seen.set(
        value,
        row.rowNumber
      );
    }
  }
}

function keyToken(
  value
) {
  return normalize(
    value
  ).replace(
    /[^a-z0-9]/g,
    ''
  );
}

function getValueByNormalizedKey(
  row,
  wanted
) {
  const wantedToken =
    keyToken(
      wanted
    );

  const key =
    Object.keys(
      row
    ).find(
      (candidate) =>
        keyToken(
          candidate
        ) ===
        wantedToken
    );

  return key
    ? row[key]
    : undefined;
}

function getField(
  row,
  ...aliases
) {
  for (
    const alias of
    aliases
  ) {
    const value =
      getValueByNormalizedKey(
        row,
        alias
      );

    if (
      value !==
      undefined
    ) {
      return value;
    }
  }

  return undefined;
}

function detectPolicySuggestions(
  rawRows
) {
  const headers =
    Object.keys(
      rawRows[0] ||
        {}
    );

  const bases =
    new Set();

  for (
    const header of
    headers
  ) {
    const token =
      keyToken(
        header
      );

    const match =
      token.match(
        /^(.*?)(quota|paid|paystatus)$/
      );

    if (
      match?.[1]
    ) {
      bases.add(
        match[1]
      );
    }
  }

  if (
    headers.some(
      (header) =>
        keyToken(
          header
        ) ===
        'leavetype'
    )
  ) {
    for (
      const row of
      rawRows
    ) {
      const leaveType =
        normalizeLeaveType(
          getValueByNormalizedKey(
            row,
            'leaveType'
          )
        );

      if (
        leaveType
      ) {
        bases.add(
          leaveType
        );
      }
    }
  }

  const suggestions =
    [];

  for (
    const base of
    bases
  ) {
    const leaveType =
      normalizeLeaveType(
        base
      );

    if (
      !leaveType
    ) {
      continue;
    }

    const quotaByGrade =
      new Map();

    let isPaid =
      false;

    let hasExplicitPaid =
      false;

    for (
      const row of
      rawRows
    ) {
      const rowLeaveType =
        normalizeLeaveType(
          getValueByNormalizedKey(
            row,
            'leaveType'
          )
        );

      if (
        rowLeaveType &&
        rowLeaveType !==
          leaveType
      ) {
        continue;
      }

      const grade =
        clean(
          getValueByNormalizedKey(
            row,
            'grade'
          )
        );

      const quotaValue =
        getValueByNormalizedKey(
          row,
          `${base}_quota`
        ) ??
        getValueByNormalizedKey(
          row,
          `${base}Quota`
        ) ??
        (
          rowLeaveType ===
          leaveType
            ? getValueByNormalizedKey(
                row,
                'quota'
              )
            : undefined
        );

      const paidValue =
        getValueByNormalizedKey(
          row,
          `${base}_paid`
        ) ??
        getValueByNormalizedKey(
          row,
          `${base}Paid`
        ) ??
        getValueByNormalizedKey(
          row,
          `${base}PayStatus`
        ) ??
        (
          rowLeaveType ===
          leaveType
            ? getValueByNormalizedKey(
                row,
                'paid'
              )
            : undefined
        );

      if (
        clean(
          paidValue
        )
      ) {
        hasExplicitPaid =
          true;

        isPaid =
          parseBool(
            paidValue,
            false
          );
      }

      if (
        grade &&
        clean(
          quotaValue
        )
      ) {
        const quota =
          Number(
            quotaValue
          );

        if (
          Number.isFinite(
            quota
          ) &&
          quota >
            0
        ) {
          quotaByGrade.set(
            normalize(
              grade
            ),
            {
              gradeName:
                grade,
              yearlyQuota:
                quota,
            }
          );
        }
      }
    }

    suggestions.push({
      leaveType,
      isPaid:
        hasExplicitPaid
          ? isPaid
          : false,
      gradeQuotas:
        Array.from(
          quotaByGrade.values()
        ),
      creatable:
        quotaByGrade.size >
        0,
    });
  }

  return suggestions;
}

async function buildPreview(
  rawRows
) {
  const [
    departments,
    designations,
    grades,
  ] =
    await Promise.all([
      Department.find({})
        .lean(),
      Designation.find({})
        .lean(),
      Grade.find({})
        .lean(),
    ]);

  /*
   * User has global unique indexes for email / nationalId / employeeId.
   * Raw collection lookup checks conflicts across all tenants without exposing
   * any other organization's details to the Admin.
   */
  const rawEmails =
    rawRows
      .map(
        (row) =>
          normalize(
            getField(
              row,
              'email',
              'emailAddress'
            )
          )
      )
      .filter(Boolean);

  const rawCnics =
    rawRows
      .map(
        (row) =>
          clean(
            getField(
              row,
              'cnic',
              'nationalId'
            )
          )
      )
      .filter(Boolean);

  const rawEmployeeIds =
    rawRows
      .map(
        (row) =>
          clean(
            getField(
              row,
              'employeeId',
              'employeeCode',
              'empId'
            )
          )
      )
      .filter(Boolean);

  const existingUsers =
    await User.collection
      .find({
        $or: [
          {
            email: {
              $in:
                rawEmails,
            },
          },
          {
            nationalId: {
              $in:
                rawCnics,
            },
          },
          {
            employeeId: {
              $in:
                rawEmployeeIds,
            },
          },
        ],
      })
      .project({
        email: 1,
        nationalId: 1,
        employeeId: 1,
      })
      .toArray();

  const existingEmailSet =
    new Set(
      existingUsers.map(
        (item) =>
          normalize(
            item.email
          )
      )
    );

  const existingCnicOwner =
    new Map(
      existingUsers
        .filter(
          (item) =>
            item.nationalId
        )
        .map(
          (item) => [
            clean(
              item.nationalId
            ),
            normalize(
              item.email
            ),
          ]
        )
    );

  const existingEmployeeIdOwner =
    new Map(
      existingUsers
        .filter(
          (item) =>
            item.employeeId
        )
        .map(
          (item) => [
            clean(
              item.employeeId
            ),
            normalize(
              item.email
            ),
          ]
        )
    );

  const deptSet =
    new Set(
      departments.map(
        (item) =>
          normalize(
            item.name
          )
      )
    );

  const designationSet =
    new Set(
      designations.map(
        (item) =>
          normalize(
            item.name
          )
      )
    );

  const gradeSet =
    new Set(
      grades.map(
        (item) =>
          normalize(
            item.name
          )
      )
    );

  const rows =
    rawRows.map(
      (
        raw,
        index
      ) => {
        const sheetRole =
          normalize(
            getField(
              raw,
              'role',
              'portalRole'
            )
          );

        const row = {
          rowNumber:
            index + 2,
          fullName:
            clean(
              getField(
                raw,
                'fullName',
                'name',
                'employeeName'
              )
            ),
          email:
            normalize(
              getField(
                raw,
                'email',
                'emailAddress'
              )
            ),
          employeeId:
            clean(
              getField(
                raw,
                'employeeId',
                'employeeCode',
                'empId'
              )
            ),
          cnic:
            clean(
              getField(
                raw,
                'cnic',
                'nationalId'
              )
            ),
          phone:
            clean(
              getField(
                raw,
                'phone',
                'phoneNumber',
                'mobile'
              )
            ),
          designation:
            clean(
              getField(
                raw,
                'designation',
                'jobTitle'
              )
            ),
          department:
            clean(
              getField(
                raw,
                'department',
                'dept'
              )
            ),
          grade:
            clean(
              getField(
                raw,
                'grade',
                'employeeGrade'
              )
            ),
          dateOfJoining:
            clean(
              getField(
                raw,
                'dateOfJoining',
                'joiningDate',
                'dateJoined'
              )
            ),
          managerReference:
            managerReference(
              raw
            ),
          sheetRole,
          portalAccess:
            sheetRole ===
            'manager'
              ? 'manager'
              : 'employee',
          exists:
            existingEmailSet.has(
              normalize(
                getField(
                  raw,
                  'email',
                  'emailAddress'
                )
              )
            ),
          errors: [],
        };

        if (
          row.exists
        ) {
          return row;
        }

        if (
          !row.fullName
        ) {
          row.errors.push(
            'Full Name is required.'
          );
        }

        if (
          !EMAIL_RE.test(
            row.email
          )
        ) {
          row.errors.push(
            'Valid Email is required.'
          );
        }

        if (
          !row.employeeId
        ) {
          row.errors.push(
            'Employee ID is required.'
          );
        }

        if (
          !CNIC_RE.test(
            row.cnic
          )
        ) {
          row.errors.push(
            'CNIC must use 12345-1234567-1 format.'
          );
        }

        if (
          !row.designation
        ) {
          row.errors.push(
            'Designation is required.'
          );
        }

        if (
          !row.department
        ) {
          row.errors.push(
            'Department is required.'
          );
        }

        if (
          !row.grade
        ) {
          row.errors.push(
            'Grade is required.'
          );
        }

        if (
          !row.dateOfJoining ||
          !dateIsValid(
            row.dateOfJoining
          )
        ) {
          row.errors.push(
            'Date of Joining is required in YYYY-MM-DD format.'
          );
        }

        if (
          ![
            'employee',
            'manager',
          ].includes(
            sheetRole
          )
        ) {
          row.errors.push(
            'Role must be employee or manager.'
          );
        }

        const cnicOwner =
          existingCnicOwner.get(
            row.cnic
          );

        if (
          cnicOwner &&
          cnicOwner !==
            row.email
        ) {
          row.errors.push(
            'CNIC is already used by another existing account.'
          );
        }

        const employeeIdOwner =
          existingEmployeeIdOwner.get(
            row.employeeId
          );

        if (
          employeeIdOwner &&
          employeeIdOwner !==
            row.email
        ) {
          row.errors.push(
            'Employee ID is already used by another existing account.'
          );
        }

        return row;
      }
    );

  addDuplicateErrors(
    rows,
    'email',
    'Email'
  );

  addDuplicateErrors(
    rows,
    'cnic',
    'CNIC',
    clean
  );

  addDuplicateErrors(
    rows,
    'employeeId',
    'Employee ID',
    clean
  );

  const missingDepartments =
    Array.from(
      new Set(
        rows
          .filter(
            (row) =>
              !row.exists
          )
          .map(
            (row) =>
              row.department
          )
          .filter(
            (name) =>
              name &&
              !deptSet.has(
                normalize(
                  name
                )
              )
          )
      )
    );

  const missingDesignations =
    Array.from(
      new Set(
        rows
          .filter(
            (row) =>
              !row.exists
          )
          .map(
            (row) =>
              row.designation
          )
          .filter(
            (name) =>
              name &&
              !designationSet.has(
                normalize(
                  name
                )
              )
          )
      )
    );

  const missingGrades =
    Array.from(
      new Set(
        rows
          .filter(
            (row) =>
              !row.exists
          )
          .map(
            (row) =>
              row.grade
          )
          .filter(
            (name) =>
              name &&
              !gradeSet.has(
                normalize(
                  name
                )
              )
          )
      )
    );

  const existingManagers =
    await User.find({
      role:
        'manager',
      status:
        'active',
    })
      .select(
        '_id fullName email department'
      )
      .lean();

  return {
    rows,
    missingDepartments,
    missingDesignations,
    missingGrades,
    existingManagers:
      existingManagers.map(
        (manager) => ({
          id:
            String(
              manager._id
            ),
          fullName:
            manager.fullName,
          email:
            manager.email,
          department:
            manager.department,
        })
      ),
    policySuggestions:
      detectPolicySuggestions(
        rawRows
      ),
  };
}

function selectedAccess(
  row,
  decisionMap
) {
  const requested =
    decisionMap.get(
      row.rowNumber
    )?.portalAccess;

  return [
    'employee',
    'manager',
    'none',
  ].includes(
    requested
  )
    ? requested
    : row.portalAccess;
}

function buildPlannedManagerIndexes(
  preview,
  decisionMap,
  existingManagers
) {
  const byEmail =
    new Map();

  const byName =
    new Map();

  const add =
    (
      item
    ) => {
      if (
        item.email
      ) {
        byEmail.set(
          normalize(
            item.email
          ),
          item
        );
      }

      const key =
        normalize(
          item.fullName
        );

      if (
        !key
      ) {
        return;
      }

      if (
        !byName.has(
          key
        )
      ) {
        byName.set(
          key,
          []
        );
      }

      byName
        .get(
          key
        )
        .push(
          item
        );
    };

  for (
    const manager of
    existingManagers
  ) {
    add({
      source:
        'existing',
      id:
        manager._id,
      email:
        manager.email,
      fullName:
        manager.fullName,
      department:
        manager.department,
    });
  }

  for (
    const row of
    preview.rows
  ) {
    if (
      row.exists
    ) {
      continue;
    }

    if (
      selectedAccess(
        row,
        decisionMap
      ) !==
      'manager'
    ) {
      continue;
    }

    add({
      source:
        'csv',
      rowNumber:
        row.rowNumber,
      email:
        row.email,
      fullName:
        row.fullName,
      department:
        row.department,
    });
  }

  return {
    byEmail,
    byName,
  };
}

function resolveManagerPlan(
  row,
  indexes
) {
  const reference =
    normalize(
      row.managerReference
    );

  if (
    !reference
  ) {
    return null;
  }

  const byEmail =
    indexes.byEmail.get(
      reference
    );

  if (
    byEmail
  ) {
    return byEmail;
  }

  const byName =
    indexes.byName.get(
      reference
    ) ||
    [];

  if (
    byName.length ===
    1
  ) {
    return byName[0];
  }

  if (
    byName.length >
    1
  ) {
    throw new ValidationError(
      `Manager "${row.managerReference}" is ambiguous for ${row.fullName}. Use managerEmail in the CSV.`
    );
  }

  throw new ValidationError(
    `Manager "${row.managerReference}" for ${row.fullName} was not found as an active Manager or a CSV row with Manager portal access.`
  );
}

export const previewSmartCsv =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const rawRows =
        parseRows(
          req.file
        );

      const preview =
        await buildPreview(
          rawRows
        );

      return res.json({
        success: true,
        preview,
      });
    }
  );

export const commitSmartCsv =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const rawRows =
        parseRows(
          req.file
        );

      let decisions;

      try {
        decisions =
          JSON.parse(
            String(
              req.body.decisions ||
              '{}'
            )
          );
      } catch {
        throw new ValidationError(
          'Import decisions are invalid.'
        );
      }

      const preview =
        await buildPreview(
          rawRows
        );

      const permissions =
        decisions.permissions ||
        {};

      if (
        preview.rows.some(
          (row) =>
            row.errors.length >
            0
        )
      ) {
        throw new ValidationError(
          'CSV contains blocking row errors. Review the preview and fix the sheet before importing.'
        );
      }

      if (
        preview.missingDepartments.length &&
        !permissions.autoCreateDepartments
      ) {
        throw new ValidationError(
          'Missing Departments exist. Allow automatic Department creation or cancel the import.'
        );
      }

      if (
        preview.missingDesignations.length &&
        !permissions.autoCreateDesignations
      ) {
        throw new ValidationError(
          'Missing Designations exist. Allow automatic Designation creation or cancel the import.'
        );
      }

      if (
        preview.missingGrades.length &&
        !permissions.autoCreateGrades
      ) {
        throw new ValidationError(
          'Missing Grades exist. Allow automatic Grade creation or cancel the import.'
        );
      }

      const decisionMap =
        new Map(
          (
            decisions.rows ||
            []
          ).map(
            (item) => [
              Number(
                item.rowNumber
              ),
              item,
            ]
          )
        );

      const existingManagers =
        await User.find({
          role:
            'manager',
          status:
            'active',
        })
          .select(
            '_id email fullName department'
          )
          .lean();

      const plannedManagers =
        buildPlannedManagerIndexes(
          preview,
          decisionMap,
          existingManagers
        );

      const managerPlans =
        new Map();

      if (
        permissions.applyManagerAssignments
      ) {
        for (
          const row of
          preview.rows
        ) {
          if (
            row.exists ||
            !row.managerReference
          ) {
            continue;
          }

          const plan =
            resolveManagerPlan(
              row,
              plannedManagers
            );

          if (
            plan?.source ===
              'csv' &&
            plan.rowNumber ===
              row.rowNumber
          ) {
            throw new ValidationError(
              `${row.fullName} cannot be assigned as their own Manager.`
            );
          }

          if (
            plan &&
            normalize(
              plan.department
            ) !==
              normalize(
                row.department
              )
          ) {
            throw new ValidationError(
              `Manager "${row.managerReference}" belongs to "${plan.department}", but ${row.fullName} belongs to "${row.department}". Manager assignment must use the same department.`
            );
          }

          managerPlans.set(
            row.rowNumber,
            plan
          );
        }
      }

      const session =
        await mongoose.startSession();

      const queuedCredentials =
        [];

      const importedRows =
        [];

      const skippedExisting =
        preview.rows
          .filter(
            (row) =>
              row.exists
          )
          .map(
            (row) =>
              row.email
          );

      let policiesCreated =
        0;

      try {
        await session.withTransaction(
          async () => {
            /*
             * withTransaction may retry this callback after a transient error.
             * Reset in-memory result buffers so retries never duplicate queued
             * credential emails or response counts.
             */
            queuedCredentials.length =
              0;

            importedRows.length =
              0;

            policiesCreated =
              0;

            if (
              permissions.autoCreateDepartments
            ) {
              for (
                const name of
                preview.missingDepartments
              ) {
                await Department.create(
                  [
                    {
                      name,
                    },
                  ],
                  {
                    session,
                  }
                );
              }
            }

            if (
              permissions.autoCreateDesignations
            ) {
              for (
                const name of
                preview.missingDesignations
              ) {
                await Designation.create(
                  [
                    {
                      name,
                    },
                  ],
                  {
                    session,
                  }
                );
              }
            }

            if (
              permissions.autoCreateGrades
            ) {
              for (
                const name of
                preview.missingGrades
              ) {
                await Grade.create(
                  [
                    {
                      name,
                      description:
                        'Created automatically from Smart CSV import.',
                    },
                  ],
                  {
                    session,
                  }
                );
              }
            }

            const grades =
              await Grade.find({})
                .session(
                  session
                )
                .lean();

            const gradeMap =
              new Map(
                grades.map(
                  (grade) => [
                    normalize(
                      grade.name
                    ),
                    grade,
                  ]
                )
              );

            /*
             * Two-pass user creation:
             * Pass 1 creates all NEW rows with managerId=null.
             * Pass 2 assigns Managers after all CSV Manager accounts exist.
             */
            const createdByRow =
              new Map();

            for (
              const row of
              preview.rows
            ) {
              if (
                row.exists
              ) {
                continue;
              }

              const portalAccess =
                selectedAccess(
                  row,
                  decisionMap
                );

              const hasPortalAccess =
                portalAccess !==
                'none';

              const finalRole =
                portalAccess ===
                'manager'
                  ? 'manager'
                  : 'employee';

              const grade =
                gradeMap.get(
                  normalize(
                    row.grade
                  )
                );

              if (
                !grade
              ) {
                throw new ValidationError(
                  `Grade "${row.grade}" could not be resolved for ${row.fullName}.`
                );
              }

              const temporaryPassword =
                generateTemporaryPassword();

              const [
                user,
              ] =
                await User.create(
                  [
                    {
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
                          temporaryPassword,
                          12
                        ),
                      passwordChangedFromDefault:
                        hasPortalAccess
                          ? false
                          : true,
                      mustChangePassword:
                        hasPortalAccess,
                      role:
                        finalRole,
                      gradeId:
                        grade._id,
                      managerId:
                        null,
                      canApproveOtherDepartments:
                        false,
                      employeeId:
                        row.employeeId,
                      designation:
                        row.designation,
                      department:
                        row.department,
                      phone:
                        row.phone ||
                        undefined,
                      dateOfJoining:
                        new Date(
                          `${row.dateOfJoining}T00:00:00.000Z`
                        ),
                      detailsStatus:
                        'complete',
                      pendingFields:
                        [],
                      status:
                        hasPortalAccess
                          ? 'active'
                          : 'inactive',
                    },
                  ],
                  {
                    session,
                  }
                );

              createdByRow.set(
                row.rowNumber,
                user
              );

              importedRows.push(
                row
              );

              if (
                hasPortalAccess
              ) {
                queuedCredentials.push({
                  userId:
                    user._id,
                  to:
                    user.email,
                  fullName:
                    user.fullName,
                  roleLabel:
                    finalRole ===
                    'manager'
                      ? 'Manager'
                      : 'Employee',
                  temporaryPassword,
                });
              }
            }

            if (
              permissions.applyManagerAssignments
            ) {
              for (
                const row of
                preview.rows
              ) {
                if (
                  row.exists ||
                  !row.managerReference
                ) {
                  continue;
                }

                const plan =
                  managerPlans.get(
                    row.rowNumber
                  );

                if (!plan) {
                  continue;
                }

                let managerId =
                  plan.id ||
                  null;

                if (
                  plan.source ===
                  'csv'
                ) {
                  const createdManager =
                    createdByRow.get(
                      plan.rowNumber
                    );

                  if (
                    !createdManager ||
                    createdManager.role !==
                      'manager' ||
                    createdManager.status !==
                      'active'
                  ) {
                    throw new ValidationError(
                      `CSV Manager "${plan.fullName}" could not be created with Manager portal access.`
                    );
                  }

                  managerId =
                    createdManager._id;
                }

                const employee =
                  createdByRow.get(
                    row.rowNumber
                  );

                if (
                  employee &&
                  managerId
                ) {
                  employee.managerId =
                    managerId;

                  await employee.save({
                    session,
                  });
                }
              }
            }

            if (
              permissions.createLeavePolicies
            ) {
              const refreshedGrades =
                await Grade.find({})
                  .session(
                    session
                  )
                  .lean();

              const refreshedGradeMap =
                new Map(
                  refreshedGrades.map(
                    (grade) => [
                      normalize(
                        grade.name
                      ),
                      grade,
                    ]
                  )
                );

              for (
                const suggestion of
                preview.policySuggestions
              ) {
                /*
                 * No quota in the sheet => silently skip this detected policy.
                 * Existing LeavePolicy architecture stays untouched and quota
                 * is never invented.
                 */
                if (
                  !suggestion.creatable ||
                  suggestion.gradeQuotas.length ===
                    0
                ) {
                  continue;
                }

                const existing =
                  await LeavePolicy.findOne({
                    leaveType:
                      suggestion.leaveType,
                  })
                    .session(
                      session
                    )
                    .select(
                      '_id'
                    )
                    .lean();

                if (
                  existing
                ) {
                  continue;
                }

                const gradeQuotas =
                  suggestion.gradeQuotas.map(
                    (item) => {
                      const grade =
                        refreshedGradeMap.get(
                          normalize(
                            item.gradeName
                          )
                        );

                      if (
                        !grade
                      ) {
                        throw new ValidationError(
                          `Grade "${item.gradeName}" required by ${suggestion.leaveType} policy does not exist.`
                        );
                      }

                      return {
                        gradeId:
                          grade._id,
                        yearlyQuota:
                          item.yearlyQuota,
                      };
                    }
                  );

                await LeavePolicy.create(
                  [
                    {
                      leaveType:
                        suggestion.leaveType,
                      applicableRole:
                        'All Employees',
                      gradeQuotas,
                      isPaid:
                        suggestion.isPaid ??
                        false,
                      minDaysNoticeRequired:
                        0,
                      documentRequirement:
                        'optional',
                      carryForwardAllowed:
                        false,
                      maxCarryForwardDays:
                        0,
                      finalApprovalMode:
                        true,
                      approvalRouting: {
                        designation:
                          null,
                        department:
                          null,
                        approverIds:
                          [],
                      },
                      adminOnlyApproval:
                        false,
                    },
                  ],
                  {
                    session,
                  }
                );

                policiesCreated +=
                  1;
              }
            }

            /*
             * Store encrypted credential jobs inside the SAME MongoDB
             * transaction as the import. QStash scheduling happens only after
             * the transaction commits, so a failed import can never send
             * credentials for rolled-back users.
             */
            const jobs =
              await createCredentialEmailJobs({
                items:
                  queuedCredentials,
                session,
              });

            queuedCredentials.splice(
              0,
              queuedCredentials.length,
              ...jobs.map(
                (job) => ({
                  jobId:
                    job._id,
                })
              )
            );
          }
        );
      } catch (error) {
        if (
          error?.code ===
          11000
        ) {
          throw new ValidationError(
            'Import stopped because an Email, CNIC or Employee ID already exists. Nothing from this Smart Import was saved.'
          );
        }

        throw error;
      } finally {
        await session.endSession();
      }

      /*
       * Vercel-safe scheduling:
       * QStash receives one message per credential job with 0s, 30s, 60s...
       * delays. The Vercel backend does NOT need a permanent worker.
       */
      const scheduling =
        await scheduleCredentialEmailJobs(
          queuedCredentials.map(
            (item) =>
              item.jobId
          )
        );

      /*
       * Balance records are derived from Leave Policies and lazily self-heal
       * when queried. Sync after commit for immediate UI consistency.
       */
      try {
        await syncCurrentYearBalancesForAllEmployees();
      } catch (error) {
        console.error(
          'Smart CSV balance sync failed after successful import:',
          error.message
        );
      }

      return res.json({
        success: true,
        message:
          `${importedRows.length} new employee record(s) imported. ` +
          `${skippedExisting.length} existing email(s) skipped. ` +
          `${scheduling.scheduled} Temporary Password email(s) scheduled through QStash at 30-second intervals. ` +
          `${scheduling.failed > 0 ? `${scheduling.failed} email schedule(s) need retry. ` : ''}` +
          `${policiesCreated} Leave Polic${policiesCreated === 1 ? 'y' : 'ies'} created from sheet quotas.`,
        data: {
          imported:
            importedRows.length,
          skippedExisting:
            skippedExisting.length,
          emailsQueued:
            scheduling.scheduled,
          emailSchedulingFailed:
            scheduling.failed,
          policiesCreated,
        },
      });
    }
  );


export const retrySmartCsvCredentialEmails =
  asyncHandler(
    async (
      _req,
      res
    ) => {
      const result =
        await retryPendingCredentialEmailJobs();

      return res.json({
        success:
          true,
        message:
          `${result.scheduled} pending credential email(s) scheduled through QStash. ${result.failed} failed to schedule.`,
        data:
          result,
      });
    }
  );
