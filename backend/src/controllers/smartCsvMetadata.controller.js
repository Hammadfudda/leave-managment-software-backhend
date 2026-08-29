import mongoose from 'mongoose';

import {
  parse,
} from 'csv-parse/sync';

import User from '../models/User.js';
import RoleLabel from '../models/RoleLabel.js';
import Department from '../models/Department.js';
import LeaveBalance from '../models/LeaveBalance.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  resolveLeaveYearForUser,
} from '../services/leaveYear.service.js';

import {
  syncPolicyBalancesForUser,
} from '../services/balance.service.js';

import {
  upsertYearlySnapshotForBalance,
} from '../services/yearlySnapshot.service.js';

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

function keyToken(value) {
  return normalize(
    value
  ).replace(
    /[^a-z0-9]/g,
    ''
  );
}

function getField(
  row,
  ...aliases
) {
  for (
    const alias
    of aliases
  ) {
    const wanted =
      keyToken(
        alias
      );

    const key =
      Object.keys(
        row
      ).find(
        (candidate) =>
          keyToken(
            candidate
          ) ===
          wanted
      );

    if (
      key !==
      undefined
    ) {
      return row[key];
    }
  }

  return undefined;
}

function parseBool(value) {
  return [
    'true',
    'yes',
    '1',
    'y',
  ].includes(
    normalize(
      value
    )
  );
}

function parseRows(file) {
  if (!file) {
    throw new ValidationError(
      'A CSV file is required.'
    );
  }

  try {
    const rows =
      parse(
        file.buffer,
        {
          columns:
            true,
          skip_empty_lines:
            true,
          trim:
            true,
          bom:
            true,
        }
      );

    if (
      !rows.length
    ) {
      throw new ValidationError(
        'CSV file does not contain employee rows.'
      );
    }

    return rows;
  } catch (
    error
  ) {
    if (
      error instanceof
      ValidationError
    ) {
      throw error;
    }

    throw new ValidationError(
      `Unable to read CSV file: ${error.message}`
    );
  }
}

function usedLeaveTypes(
  rawRows
) {
  const headers =
    Object.keys(
      rawRows[
        0
      ] ||
        {}
    );

  return Array.from(
    new Set(
      headers
        .map(
          (header) => {
            const token =
              keyToken(
                header
              );

            const match =
              token.match(
                /^(.+?)used$/
              );

            if (
              !match?.[1] ||
              match[1] ===
                'total'
            ) {
              return '';
            }

            return match[1];
          }
        )
        .filter(Boolean)
    )
  );
}

function usedValue(
  row,
  leaveType
) {
  const value =
    getField(
      row,
      `${leaveType}Used`,
      `${leaveType}_used`
    );

  if (
    clean(
      value
    ) ===
    ''
  ) {
    return null;
  }

  return Number(
    value
  );
}

async function buildMetadataPreview(
  rawRows,
  forceEmails =
    new Set()
) {
  const leaveTypes =
    usedLeaveTypes(
      rawRows
    );

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

  const [
    divisions,
    departments,
    existingUsers,
  ] =
    await Promise.all([
      RoleLabel.find({})
        .select(
          'name'
        )
        .lean(),

      Department.find({})
        .select(
          'name divisionName'
        )
        .lean(),

      User.find({
        email: {
          $in:
            rawEmails,
        },
      })
        .select(
          'email'
        )
        .lean(),
    ]);

  const existingEmailSet =
    new Set(
      existingUsers.map(
        (user) =>
          normalize(
            user.email
          )
      )
    );

  const divisionSet =
    new Set(
      divisions.map(
        (division) =>
          normalize(
            division.name
          )
      )
    );

  const departmentByName =
    new Map(
      departments.map(
        (department) => [
          normalize(
            department.name
          ),
          department,
        ]
      )
    );

  const missingDivisions =
    new Set();

  const errors =
    [];

  rawRows.forEach(
    (
      row,
      index
    ) => {
      const rowNumber =
        index +
        2;

      const email =
        normalize(
          getField(
            row,
            'email',
            'emailAddress'
          )
        );

      if (
        email &&
        existingEmailSet.has(
          email
        ) &&
        !forceEmails.has(
          email
        )
      ) {
        return;
      }

      const division =
        clean(
          getField(
            row,
            'division',
            'roleLabel',
            'jobRole',
            'hrRole',
            'masterRole'
          )
        );

      if (
        division &&
        !divisionSet.has(
          normalize(
            division
          )
        )
      ) {
        missingDivisions.add(
          division
        );
      }

      const departmentName =
        clean(
          getField(
            row,
            'department',
            'dept'
          )
        );

      const existingDepartment =
        departmentByName.get(
          normalize(
            departmentName
          )
        );

      if (
        existingDepartment?.divisionName &&
        division &&
        normalize(
          existingDepartment.divisionName
        ) !==
          normalize(
            division
          )
      ) {
        errors.push({
          rowNumber,
          message:
            `Department "${departmentName}" belongs to Division "${existingDepartment.divisionName}", not "${division}".`,
        });
      }

      for (
        const leaveType
        of leaveTypes
      ) {
        const used =
          usedValue(
            row,
            leaveType
          );

        if (
          used ===
          null
        ) {
          continue;
        }

        if (
          !Number.isFinite(
            used
          ) ||
          used <
            0
        ) {
          errors.push({
            rowNumber,
            message:
              `${leaveType}Used must be a number greater than or equal to 0.`,
          });
        }
      }
    }
  );

  return {
    missingDivisions:
      Array.from(
        missingDivisions
      ),

    /*
     * Compatibility key for the current frontend component.
     */
    missingRoles:
      Array.from(
        missingDivisions
      ),

    usedLeaveTypes:
      leaveTypes,

    errors,
  };
}

export const previewSmartCsvMetadata =
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
        await buildMetadataPreview(
          rawRows
        );

      res.json({
        success:
          true,
        preview,
      });
    }
  );

export const commitSmartCsvMetadata =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const rawRows =
        parseRows(
          req.file
        );

      let decisions =
        {};

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
          'Import metadata decisions are invalid.'
        );
      }

      const targetEmails =
        new Set(
          (
            decisions.targetEmails ||
            []
          ).map(
            normalize
          )
        );

      const preview =
        await buildMetadataPreview(
          rawRows,
          targetEmails
        );

      if (
        preview.errors.length
      ) {
        throw new ValidationError(
          'CSV contains invalid Division / starting leave usage values.'
        );
      }

      const autoCreateDivisions =
        Boolean(
          decisions.autoCreateDivisions ||
          decisions.autoCreateRoles
        );

      if (
        preview.missingDivisions.length &&
        !autoCreateDivisions
      ) {
        throw new ValidationError(
          'Missing Divisions exist. Allow automatic Division creation before importing.'
        );
      }

      if (
        targetEmails.size ===
        0
      ) {
        return res.json({
          success: true,
          data: {
            employeesUpdated:
              0,
            balancesUpdated:
              0,
          },
        });
      }

      const targetRows =
        rawRows.filter(
          (row) =>
            targetEmails.has(
              normalize(
                getField(
                  row,
                  'email',
                  'emailAddress'
                )
              )
            )
        );

      const emails =
        targetRows.map(
          (row) =>
            normalize(
              getField(
                row,
                'email',
                'emailAddress'
              )
            )
        );

      const users =
        await User.find({
          email: {
            $in:
              emails,
          },
        });

      const userByEmail =
        new Map(
          users.map(
            (user) => [
              normalize(
                user.email
              ),
              user,
            ]
          )
        );

      if (
        userByEmail.size !==
        new Set(
          emails
        ).size
      ) {
        throw new ValidationError(
          'One or more newly imported employees could not be resolved for Division / leave balance setup.'
        );
      }

      const leaveTypes =
        preview.usedLeaveTypes;

      const plannedUserUpdates =
        [];

      const plannedDepartmentAssignments =
        [];

      const plannedBalanceUpdates =
        [];

      for (
        const row
        of targetRows
      ) {
        const email =
          normalize(
            getField(
              row,
              'email',
              'emailAddress'
            )
          );

        const user =
          userByEmail.get(
            email
          );

        const division =
          clean(
            getField(
              row,
              'division',
              'roleLabel',
              'jobRole',
              'hrRole',
              'masterRole'
            )
          );

        const departmentName =
          clean(
            getField(
              row,
              'department',
              'dept'
            )
          );

        const canApproveValue =
          getField(
            row,
            'canApproveOtherDepartments'
          );

        const userSet =
          {};

        if (division) {
          userSet.roleLabel =
            division;
        }

        if (
          user.role ===
            'manager' &&
          clean(
            canApproveValue
          ) !==
            ''
        ) {
          userSet.canApproveOtherDepartments =
            parseBool(
              canApproveValue
            );
        }

        if (
          Object.keys(
            userSet
          ).length
        ) {
          plannedUserUpdates.push({
            userId:
              user._id,
            set:
              userSet,
          });
        }

        if (
          division &&
          departmentName
        ) {
          plannedDepartmentAssignments.push({
            division,
            departmentName,
          });
        }

        const year =
          await resolveLeaveYearForUser(
            user
          );

        await syncPolicyBalancesForUser(
          user._id,
          year
        );

        const balances =
          await LeaveBalance.find({
            employeeId:
              user._id,
            year,
          });

        const balanceMap =
          new Map(
            balances.map(
              (balance) => [
                normalize(
                  balance.leaveType
                ),
                balance,
              ]
            )
          );

        for (
          const leaveType
          of leaveTypes
        ) {
          const used =
            usedValue(
              row,
              leaveType
            );

          if (
            used ===
            null
          ) {
            continue;
          }

          const balance =
            balanceMap.get(
              normalize(
                leaveType
              )
            );

          if (!balance) {
            if (
              used ===
              0
            ) {
              continue;
            }

            throw new ValidationError(
              `No active ${leaveType} leave quota is available for ${user.fullName}. Create/enable the matching Leave Policy before setting used leave.`
            );
          }

          if (
            used >
            Number(
              balance.quota ||
              0
            )
          ) {
            throw new ValidationError(
              `${user.fullName} has ${balance.quota} granted ${leaveType} day(s), so used leave cannot be set to ${used}.`
            );
          }

          plannedBalanceUpdates.push({
            balanceId:
              balance._id,
            used,
            user,
          });
        }
      }

      const session =
        await mongoose.startSession();

      try {
        await session.withTransaction(
          async () => {
            if (
              autoCreateDivisions
            ) {
              for (
                const name
                of preview.missingDivisions
              ) {
                await RoleLabel.updateOne(
                  {
                    name,
                  },
                  {
                    $setOnInsert: {
                      name,
                    },
                  },
                  {
                    upsert:
                      true,
                    session,
                  }
                );
              }
            }

            for (
              const assignment
              of plannedDepartmentAssignments
            ) {
              const department =
                await Department.findOne({
                  name:
                    assignment.departmentName,
                }).session(
                  session
                );

              if (!department) {
                throw new ValidationError(
                  `Department "${assignment.departmentName}" could not be resolved.`
                );
              }

              if (
                department.divisionName &&
                normalize(
                  department.divisionName
                ) !==
                  normalize(
                    assignment.division
                  )
              ) {
                throw new ValidationError(
                  `Department "${department.name}" already belongs to Division "${department.divisionName}".`
                );
              }

              if (
                !department.divisionName
              ) {
                department.divisionName =
                  assignment.division;

                await department.save({
                  session,
                });
              }
            }

            for (
              const update
              of plannedUserUpdates
            ) {
              await User.updateOne(
                {
                  _id:
                    update.userId,
                },
                {
                  $set:
                    update.set,
                },
                {
                  session,
                }
              );
            }

            for (
              const update
              of plannedBalanceUpdates
            ) {
              await LeaveBalance.updateOne(
                {
                  _id:
                    update.balanceId,
                },
                {
                  $set: {
                    used:
                      update.used,
                  },
                },
                {
                  session,
                }
              );
            }
          }
        );
      } finally {
        await session.endSession();
      }

      for (
        const update
        of plannedBalanceUpdates
      ) {
        const balance =
          await LeaveBalance.findById(
            update.balanceId
          );

        if (balance) {
          await upsertYearlySnapshotForBalance(
            balance,
            update.user
          );
        }
      }

      res.json({
        success: true,
        data: {
          employeesUpdated:
            plannedUserUpdates.length,
          balancesUpdated:
            plannedBalanceUpdates.length,
        },
      });
    }
  );
