import {
  Parser,
} from 'json2csv';

import User from '../models/User.js';
import LeavePolicy from '../models/LeavePolicy.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  getLeaveBalancesForUser,
} from '../services/balance.service.js';

import {
  formatLeaveYearStart,
  getOrganizationLeaveYearConfig,
} from '../services/leaveYear.service.js';

function safeDateOnly(
  value
) {
  if (!value) {
    return '';
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '';
  }

  return date
    .toISOString()
    .split(
      'T'
    )[0];
}

function normalizeLeaveType(
  value
) {
  return String(
    value ||
    ''
  )
    .trim()
    .toLowerCase();
}

export const exportEmployeesCsv =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const [
        users,
        policyLeaveTypes,
        leaveYearConfig,
      ] =
        await Promise.all([
          User.find({})
            .populate(
              'gradeId'
            )
            .sort({
              fullName:
                1,
            }),

          LeavePolicy.distinct(
            'leaveType'
          ),

          getOrganizationLeaveYearConfig(
            req.currentUser.organizationId
          ),
        ]);

      const leaveTypes =
        Array.from(
          new Set(
            (
              policyLeaveTypes ||
              []
            )
              .map(
                normalizeLeaveType
              )
              .filter(
                Boolean
              )
          )
        ).sort();

      const rows =
        await Promise.all(
          users.map(
            async (
              user
            ) => {
              const balances =
                await getLeaveBalancesForUser(
                  user._id
                );

              const row = {
                fullName:
                  user.fullName ||
                  '',

                email:
                  user.email ||
                  '',

                employeeId:
                  user.employeeId ||
                  '',

                cnic:
                  user.cnic ||
                  user.nationalId ||
                  '',

                division:
                  user.roleLabel ||
                  '',

                portalAccess:
                  user.role ||
                  '',

                designation:
                  user.designation ||
                  '',

                department:
                  user.department ||
                  '',

                grade:
                  user.gradeId?.name ||
                  '',

                dateOfJoining:
                  safeDateOnly(
                    user.dateOfJoining
                  ),

                leaveYearStart:
                  formatLeaveYearStart(
                    leaveYearConfig
                  ),

                status:
                  user.status ||
                  '',

                canApproveOtherDepartments:
                  user.role ===
                  'manager'
                    ? Boolean(
                        user.canApproveOtherDepartments
                      )
                    : '',
              };

              let totalGranted =
                0;

              let totalUsed =
                0;

              let totalRemaining =
                0;

              for (
                const type
                of leaveTypes
              ) {
                const balance =
                  balances[
                    type
                  ] || {
                    quota:
                      0,
                    used:
                      0,
                    remaining:
                      0,
                  };

                const quota =
                  Number(
                    balance.quota ||
                    0
                  );

                const used =
                  Number(
                    balance.used ||
                    0
                  );

                const remaining =
                  Number(
                    balance.remaining ??
                    Math.max(
                      0,
                      quota -
                        used
                    )
                  );

                row[
                  `${type}Granted`
                ] =
                  quota;

                row[
                  `${type}Used`
                ] =
                  used;

                row[
                  `${type}Remaining`
                ] =
                  remaining;

                totalGranted +=
                  quota;

                totalUsed +=
                  used;

                totalRemaining +=
                  remaining;
              }

              row.totalLeaveGranted =
                totalGranted;

              row.totalLeaveUsed =
                totalUsed;

              row.totalLeaveRemaining =
                totalRemaining;

              return row;
            }
          )
        );

      const baseFields = [
        'fullName',
        'email',
        'employeeId',
        'cnic',
        'division',
        'portalAccess',
        'designation',
        'department',
        'grade',
        'dateOfJoining',
        'leaveYearStart',
        'status',
        'canApproveOtherDepartments',
      ];

      const leaveFields =
        leaveTypes.flatMap(
          (
            type
          ) => [
            `${type}Granted`,
            `${type}Used`,
            `${type}Remaining`,
          ]
        );

      const fields = [
        ...baseFields,
        ...leaveFields,
        'totalLeaveGranted',
        'totalLeaveUsed',
        'totalLeaveRemaining',
      ];

      const parser =
        new Parser({
          fields,
        });

      const csv =
        parser.parse(
          rows
        );

      res.header(
        'Content-Type',
        'text/csv; charset=utf-8'
      );

      res.attachment(
        `employees-export-${Date.now()}.csv`
      );

      res.send(
        csv
      );
    }
  );
