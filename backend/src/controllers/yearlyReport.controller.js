import {
  Parser,
} from 'json2csv';

import LeaveBalance
  from '../models/LeaveBalance.js';

import YearlyLeaveSnapshot
  from '../models/YearlyLeaveSnapshot.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  getLeaveYearForDate,
  getOrganizationLeaveYearConfig,
} from '../services/leaveYear.service.js';

function parseYear(
  value
) {
  const year =
    Number(
      value
    );

  if (
    !Number.isInteger(
      year
    ) ||
    year <
      2000 ||
    year >
      2200
  ) {
    throw new ValidationError(
      'A valid leave year is required.'
    );
  }

  return year;
}

async function currentLeaveYear(
  req
) {
  const config =
    await getOrganizationLeaveYearConfig(
      req.currentUser.organizationId
    );

  return getLeaveYearForDate(
    new Date(),
    config
  );
}

async function liveRowsForCurrentYear(
  year
) {
  /*
   * Current-year reporting reads directly from the real LeaveBalance
   * collection. No snapshot refresh, no employee-by-employee recalculation,
   * and no write is performed by this GET request.
   */
  const balances =
    await LeaveBalance.find({
      year,
    })
      .populate({
        path:
          'employeeId',
        select:
          'fullName employeeId roleLabel department designation gradeId status detailsStatus',
        populate: {
          path:
            'gradeId',
          select:
            'name',
        },
      })
      .lean();

  return balances
    .filter(
      (
        balance
      ) =>
        balance.employeeId &&
        balance.employeeId.status !==
          'pending_deletion'
    )
    .map(
      (
        balance
      ) => {
        const employee =
          balance.employeeId;

        const granted =
          Number(
            balance.quota ||
            0
          );

        const used =
          Number(
            balance.used ||
            0
          );

        return {
          leaveYear:
            year,

          employeeId:
            String(
              employee._id
            ),

          employeeCode:
            employee.employeeId ||
            '',

          employeeName:
            employee.fullName ||
            '',

          division:
            employee.roleLabel ||
            '',

          department:
            employee.department ||
            '',

          designation:
            employee.designation ||
            '',

          grade:
            employee.gradeId?.name ||
            '',

          leaveType:
            balance.leaveType,

          granted,

          used,

          remaining:
            Math.max(
              0,
              granted -
                used
            ),

          employeeStatus:
            employee.status ||
            '',

          detailsStatus:
            employee.detailsStatus ||
            '',

          capturedAt:
            balance.updatedAt ||
            balance.createdAt ||
            new Date(),
        };
      }
    )
    .sort(
      (
        a,
        b
      ) => {
        const byName =
          a.employeeName.localeCompare(
            b.employeeName
          );

        if (
          byName !==
          0
        ) {
          return byName;
        }

        return String(
          a.leaveType
        ).localeCompare(
          String(
            b.leaveType
          )
        );
      }
    );
}

async function snapshotRowsForPastYear(
  year
) {
  return YearlyLeaveSnapshot.find({
    leaveYear:
      year,
  })
    .sort({
      employeeName:
        1,
      leaveType:
        1,
    })
    .lean();
}

async function rowsForYear(
  req,
  year
) {
  const activeYear =
    await currentLeaveYear(
      req
    );

  if (
    Number(year) ===
    Number(activeYear)
  ) {
    return liveRowsForCurrentYear(
      year
    );
  }

  return snapshotRowsForPastYear(
    year
  );
}

export const listYearlyReport =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const year =
        parseYear(
          req.query.year
        );

      const rows =
        await rowsForYear(
          req,
          year
        );

      res.json({
        success:
          true,
        data:
          rows,
      });
    }
  );

export const exportYearlyReportCsv =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const year =
        parseYear(
          req.query.year
        );

      const snapshots =
        await rowsForYear(
          req,
          year
        );

      const rows =
        snapshots.map(
          (
            row
          ) => ({
            leaveYear:
              row.leaveYear,
            employeeId:
              row.employeeCode,
            employeeName:
              row.employeeName,
            division:
              row.division,
            department:
              row.department,
            designation:
              row.designation,
            grade:
              row.grade,
            leaveType:
              row.leaveType,
            granted:
              row.granted,
            used:
              row.used,
            remaining:
              row.remaining,
            employeeStatus:
              row.employeeStatus,
            detailsStatus:
              row.detailsStatus,
            capturedAt:
              row.capturedAt
                ? new Date(
                    row.capturedAt
                  ).toISOString()
                : '',
          })
        );

      const parser =
        new Parser({
          fields: [
            'leaveYear',
            'employeeId',
            'employeeName',
            'division',
            'department',
            'designation',
            'grade',
            'leaveType',
            'granted',
            'used',
            'remaining',
            'employeeStatus',
            'detailsStatus',
            'capturedAt',
          ],
        });

      res.header(
        'Content-Type',
        'text/csv; charset=utf-8'
      );

      res.attachment(
        `yearly-leave-report-${year}.csv`
      );

      res.send(
        parser.parse(
          rows
        )
      );
    }
  );
