import { parse } from 'csv-parse/sync';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  formatLeaveYearStart,
  getOrganizationLeaveYearConfig,
  parseLeaveYearStart,
} from '../services/leaveYear.service.js';

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

function normalizeLeaveType(
  value
) {
  return normalize(
    value
  )
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

function quotaColumns(
  row
) {
  return Object.keys(
    row
  )
    .map(
      (header) => {
        const token =
          keyToken(
            header
          );

        const match =
          token.match(
            /^(.+?)quota$/
          );

        if (
          !match?.[1]
        ) {
          return null;
        }

        return {
          header,
          leaveType:
            normalizeLeaveType(
              match[1]
            ),
        };
      }
    )
    .filter(Boolean);
}

export const validateSmartCsvRequirements =
  async (
    req,
    _res,
    next
  ) => {
    try {
      if (!req.file) {
        return next();
      }

      let rows;

      try {
        rows =
          parse(
            req.file.buffer,
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
      } catch (
        error
      ) {
        throw new ValidationError(
          `Unable to read CSV file: ${error.message}`
        );
      }

      if (
        rows.length ===
        0
      ) {
        throw new ValidationError(
          'CSV file does not contain employee rows.'
        );
      }

      const config =
        await getOrganizationLeaveYearConfig(
          req.currentUser.organizationId
        );

      const expected =
        formatLeaveYearStart(
          config
        );

      const errors =
        [];

      const quotaByGradeType =
        new Map();

      rows.forEach(
        (
          row,
          index
        ) => {
          const rowNumber =
            index +
            2;

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

          if (!division) {
            errors.push(
              `Row ${rowNumber}: Division is required.`
            );
          }

          const rawLeaveYearStart =
            clean(
              getField(
                row,
                'leaveYearStart',
                'leaveYearStartDate'
              )
            );

          if (
            !rawLeaveYearStart
          ) {
            errors.push(
              `Row ${rowNumber}: Leave Year Start is required and must match the organization setting (${expected}).`
            );
          } else {
            const parsed =
              parseLeaveYearStart(
                rawLeaveYearStart
              );

            if (
              !parsed ||
              parsed.day !==
                config.day ||
              parsed.month !==
                config.month
            ) {
              errors.push(
                `Row ${rowNumber}: Leave Year Start "${rawLeaveYearStart}" does not match the organization setting (${expected}).`
              );
            }
          }

          const grade =
            clean(
              getField(
                row,
                'grade',
                'employeeGrade'
              )
            );


          /*
           * Long-form CSV is also supported by the mature Smart CSV parser:
           * leaveType + quota. Apply the same Grade + Leave Type conflict rule
           * here so no format can silently choose "first" or "last".
           */
          const explicitLeaveType =
            normalizeLeaveType(
              getField(
                row,
                'leaveType'
              )
            );

          const explicitQuotaRaw =
            clean(
              getField(
                row,
                'quota'
              )
            );

          if (
            grade &&
            explicitLeaveType &&
            explicitQuotaRaw
          ) {
            const explicitQuota =
              Number(
                explicitQuotaRaw
              );

            if (
              !Number.isFinite(
                explicitQuota
              ) ||
              explicitQuota <
                0
            ) {
              errors.push(
                `Row ${rowNumber}: quota must be a valid number greater than or equal to 0.`
              );
            } else {
              const explicitKey =
                `${normalize(grade)}::${explicitLeaveType}`;

              const previousExplicit =
                quotaByGradeType.get(
                  explicitKey
                );

              if (
                previousExplicit &&
                previousExplicit.quota !==
                  explicitQuota
              ) {
                errors.push(
                  `Conflicting ${explicitLeaveType.replace(
                    /_/g,
                    ' '
                  )} quota for Grade ${grade}: ${previousExplicit.quota} and ${explicitQuota}. A Grade can have only one yearly quota for the same leave type.`
                );
              } else if (
                !previousExplicit
              ) {
                quotaByGradeType.set(
                  explicitKey,
                  {
                    quota:
                      explicitQuota,
                    rowNumber,
                  }
                );
              }
            }
          }

          for (
            const column
            of quotaColumns(
              row
            )
          ) {
            const raw =
              clean(
                row[
                  column.header
                ]
              );

            if (
              !raw ||
              !grade
            ) {
              continue;
            }

            const quota =
              Number(raw);

            if (
              !Number.isFinite(
                quota
              ) ||
              quota <
                0
            ) {
              errors.push(
                `Row ${rowNumber}: ${column.leaveType}Quota must be a valid number greater than or equal to 0.`
              );

              continue;
            }

            const key =
              `${normalize(grade)}::${column.leaveType}`;

            const previous =
              quotaByGradeType.get(
                key
              );

            if (
              previous &&
              previous.quota !==
                quota
            ) {
              errors.push(
                `Conflicting ${column.leaveType.replace(
                  /_/g,
                  ' '
                )} quota for Grade ${grade}: ${previous.quota} and ${quota}. A Grade can have only one yearly quota for the same leave type.`
              );
            } else if (
              !previous
            ) {
              quotaByGradeType.set(
                key,
                {
                  quota,
                  rowNumber,
                }
              );
            }
          }
        }
      );

      if (
        errors.length
      ) {
        throw new ValidationError(
          [
            'CSV validation failed.',
            ...errors.slice(
              0,
              30
            ),
            ...(errors.length >
            30
              ? [
                  `...and ${errors.length - 30} more error(s).`,
                ]
              : []),
          ].join(
            '\n'
          )
        );
      }

      req.smartCsvLeaveYearConfig =
        config;

      next();
    } catch (
      error
    ) {
      next(
        error
      );
    }
  };
