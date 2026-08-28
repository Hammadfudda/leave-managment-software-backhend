import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';

import User from '../models/User.js';
import RoleLabel from '../models/RoleLabel.js';
import LeaveBalance from '../models/LeaveBalance.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  getCurrentLeaveYear,
  syncPolicyBalancesForUser,
} from '../services/balance.service.js';

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
    const alias of
    aliases
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
      key !== undefined
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
    normalize(value)
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
          columns: true,
          skip_empty_lines:
            true,
          trim: true,
          bom: true,
        }
      );

    if (!rows.length) {
      throw new ValidationError(
        'CSV file does not contain employee rows.'
      );
    }

    return rows;
  } catch (error) {
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

function usedLeaveTypes(rawRows) {
  const headers =
    Object.keys(
      rawRows[0] ||
        {}
    );

  return Array.from(
    new Set(
      headers
        .map((header) => {
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
        })
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
    clean(value) ===
    ''
  ) {
    return null;
  }

  return Number(value);
}

function quotaValue(
  row,
  leaveType
) {
  const value =
    getField(
      row,
      `${leaveType}Quota`,
      `${leaveType}_quota`
    );

  if (
    clean(value) ===
    ''
  ) {
    return null;
  }

  return Number(value);
}

async function buildMetadataPreview(
  rawRows
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

  /*
   * Match the mature Smart CSV behavior: existing emails are skipped.
   * Raw lookup is used only to identify conflicts and never exposes another
   * organization's employee data.
   */
  const [
    roleLabels,
    existingUsers,
  ] = await Promise.all([
    RoleLabel.find({})
      .select('name')
      .lean(),

    User.collection
      .find({
        email: {
          $in:
            rawEmails,
        },
      })
      .project({
        email: 1,
      })
      .toArray(),
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

  const roleSet =
    new Set(
      roleLabels.map(
        (role) =>
          normalize(
            role.name
          )
      )
    );

  const missingRoles =
    new Set();

  const errors = [];

  rawRows.forEach(
    (row, index) => {
      const rowNumber =
        index + 2;

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
        )
      ) {
        return;
      }

      const roleLabel =
        clean(
          getField(
            row,
            'roleLabel',
            'jobRole',
            'hrRole',
            'masterRole'
          )
        );

      if (
        roleLabel &&
        !roleSet.has(
          normalize(
            roleLabel
          )
        )
      ) {
        missingRoles.add(
          roleLabel
        );
      }

      for (
        const leaveType of
        leaveTypes
      ) {
        const used =
          usedValue(
            row,
            leaveType
          );

        if (
          used === null
        ) {
          continue;
        }

        if (
          !Number.isFinite(
            used
          ) ||
          used < 0
        ) {
          errors.push({
            rowNumber,
            message:
              `${leaveType}Used must be a number greater than or equal to 0.`,
          });
          continue;
        }

        const quota =
          quotaValue(
            row,
            leaveType
          );

        if (
          quota !== null &&
          Number.isFinite(
            quota
          ) &&
          quota >= 0 &&
          used > quota
        ) {
          errors.push({
            rowNumber,
            message:
              `${leaveType}Used (${used}) cannot be greater than ${leaveType}Quota (${quota}).`,
          });
        }
      }
    }
  );

  return {
    missingRoles:
      Array.from(
        missingRoles
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
        success: true,
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

      let decisions = {};

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

      const preview =
        await buildMetadataPreview(
          rawRows
        );

      if (
        preview.errors.length
      ) {
        throw new ValidationError(
          'CSV contains invalid starting leave usage values.'
        );
      }

      if (
        preview.missingRoles.length &&
        !decisions.autoCreateRoles
      ) {
        throw new ValidationError(
          'Missing Roles exist. Allow automatic Role creation before importing.'
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

      if (
        targetEmails.size ===
        0
      ) {
        return res.json({
          success: true,
          data: {
            employeesUpdated: 0,
            balancesUpdated: 0,
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
            $in: emails,
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
        new Set(emails).size
      ) {
        throw new ValidationError(
          'One or more newly imported employees could not be resolved for HR Role / leave balance setup.'
        );
      }

      const year =
        getCurrentLeaveYear();

      /*
       * Reuse the existing LeavePolicy -> Grade quota sync instead of
       * duplicating quota logic here.
       */
      for (
        const user of
        users
      ) {
        await syncPolicyBalancesForUser(
          user._id,
          year
        );
      }

      const balances =
        await LeaveBalance.find({
          employeeId: {
            $in:
              users.map(
                (user) =>
                  user._id
              ),
          },
          year,
        });

      const balanceByKey =
        new Map(
          balances.map(
            (balance) => [
              `${balance.employeeId}:${normalize(balance.leaveType)}`,
              balance,
            ]
          )
        );

      const leaveTypes =
        preview.usedLeaveTypes;

      const plannedBalanceUpdates =
        [];

      const plannedUserUpdates =
        [];

      for (
        const row of
        targetRows
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

        const roleLabel =
          clean(
            getField(
              row,
              'roleLabel',
              'jobRole',
              'hrRole',
              'masterRole'
            )
          );

        const canApproveValue =
          getField(
            row,
            'canApproveOtherDepartments'
          );

        const userSet = {};

        if (roleLabel) {
          userSet.roleLabel =
            roleLabel;
        }

        if (
          user.role ===
            'manager' &&
          clean(
            canApproveValue
          ) !== ''
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

        for (
          const leaveType of
          leaveTypes
        ) {
          const used =
            usedValue(
              row,
              leaveType
            );

          if (
            used === null
          ) {
            continue;
          }

          const balance =
            balanceByKey.get(
              `${user._id}:${normalize(leaveType)}`
            );

          if (!balance) {
            if (used === 0) {
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
          });
        }
      }

      const session =
        await mongoose.startSession();

      try {
        await session.withTransaction(
          async () => {
            if (
              decisions.autoCreateRoles
            ) {
              for (
                const name of
                preview.missingRoles
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
                    upsert: true,
                    session,
                  }
                );
              }
            }

            for (
              const update of
              plannedUserUpdates
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
              const update of
              plannedBalanceUpdates
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
