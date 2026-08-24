import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import User from '../models/User.js';

import {
  importEmployeesCsvPending,
  completePendingEmployee,
} from './csvImport.controller.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  generateTemporaryPassword,
  sendTemporaryAccountEmail,
} from '../services/temporaryPassword.service.js';

function captureController(
  handler,
  req
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let statusCode =
        200;

      const capturedRes = {
        status(code) {
          statusCode =
            code;
          return this;
        },

        json(payload) {
          resolve({
            statusCode,
            payload,
          });
          return this;
        },

        send(payload) {
          resolve({
            statusCode,
            payload,
          });
          return this;
        },
      };

      handler(
        req,
        capturedRes,
        reject
      );
    }
  );
}

function importedEmailsFromCsv(
  file
) {
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

    return Array.from(
      new Set(
        rows
          .map(
            (row) =>
              String(
                row.email ||
                ''
              )
                .trim()
                .toLowerCase()
          )
          .filter(Boolean)
      )
    );
  } catch {
    return [];
  }
}

/*
|--------------------------------------------------------------------------
| CSV IMPORT TEMPORARY PASSWORD WRAPPER
|--------------------------------------------------------------------------
|
| The mature CSV validation/pending-details controller remains untouched.
| After a successful COMMIT only:
|
| - complete imported accounts receive random Temporary Passwords by email
| - pending accounts receive a random unknown password now, and a NEW
|   Temporary Password will be generated/emailed when Admin completes them
| - CNIC is never retained as the login password
|
*/
export const importEmployeesCsvWithTemporaryPasswords =
  asyncHandler(
    async (
      req,
      res,
      next
    ) => {
      const mode =
        String(
          req.query.mode ||
          'preview'
        ).toLowerCase();

      if (
        mode !==
        'commit'
      ) {
        return importEmployeesCsvPending(
          req,
          res,
          next
        );
      }

      const captured =
        await captureController(
          importEmployeesCsvPending,
          req
        );

      if (
        !captured.payload?.success
      ) {
        return res
          .status(
            captured.statusCode
          )
          .json(
            captured.payload
          );
      }

      const emails =
        importedEmailsFromCsv(
          req.file
        );

      const users =
        emails.length
          ? await User.find({
              email: {
                $in:
                  emails,
              },
            })
          : [];

      const failedCredentials =
        [];

      let emailed =
        0;

      let pendingNotEmailed =
        0;

      for (
        const user of
        users
      ) {
        const temporaryPassword =
          generateTemporaryPassword();

        user.passwordHash =
          await bcrypt.hash(
            temporaryPassword,
            12
          );

        user.passwordChangedFromDefault =
          false;

        user.mustChangePassword =
          true;

        user.refreshTokenHash =
          null;

        await user.save();

        if (
          user.detailsStatus ===
          'pending'
        ) {
          /*
           * Account exists for Admin completion, but credentials are not sent
           * until required employee details are complete.
           */
          pendingNotEmailed +=
            1;
          continue;
        }

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

        if (
          emailSent
        ) {
          emailed +=
            1;
        } else {
          failedCredentials.push({
            email:
              user.email,
            temporaryPassword,
          });
        }
      }

      let message =
        `${captured.payload.message || 'Employees imported successfully.'} ` +
        `${emailed} temporary-password email(s) sent.`;

      if (
        pendingNotEmailed >
        0
      ) {
        message +=
          ` ${pendingNotEmailed} Details Pending account(s) will receive a new Temporary Password after Admin completes their details.`;
      }

      if (
        failedCredentials.length >
        0
      ) {
        message +=
          ` Email delivery failed for ${failedCredentials.length} account(s). ` +
          `Share these Temporary Passwords securely: ` +
          failedCredentials
            .map(
              (item) =>
                `${item.email}: ${item.temporaryPassword}`
            )
            .join(' | ');
      }

      return res
        .status(
          captured.statusCode
        )
        .json({
          ...captured.payload,

          message,

          temporaryPasswordEmailsSent:
            emailed,

          temporaryCredentialFailures:
            failedCredentials,
        });
    }
  );

/*
|--------------------------------------------------------------------------
| COMPLETE PENDING EMPLOYEE TEMP PASSWORD WRAPPER
|--------------------------------------------------------------------------
|
| Existing completion validation/balance initialization stays untouched.
| If completion succeeds, any CNIC-derived password set by the legacy
| completion controller is immediately replaced by a random Temporary Password.
|
*/
export const completePendingEmployeeWithTemporaryPassword =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const captured =
        await captureController(
          completePendingEmployee,
          req
        );

      if (
        !captured.payload?.success
      ) {
        return res
          .status(
            captured.statusCode
          )
          .json(
            captured.payload
          );
      }

      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res
          .status(404)
          .json({
            success:
              false,
            message:
              'Employee does not exist.',
          });
      }

      const temporaryPassword =
        generateTemporaryPassword();

      user.passwordHash =
        await bcrypt.hash(
          temporaryPassword,
          12
        );

      user.passwordChangedFromDefault =
        false;

      user.mustChangePassword =
        true;

      user.refreshTokenHash =
        null;

      await user.save();

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

      const message =
        emailSent
          ? 'Employee details are complete. A Temporary Password was emailed to the employee.'
          : `Employee details are complete, but email delivery failed. Share this Temporary Password securely: ${temporaryPassword}`;

      return res
        .status(
          captured.statusCode
        )
        .json({
          ...captured.payload,

          message,

          emailSent,

          temporaryCredentials:
            emailSent
              ? undefined
              : {
                  email:
                    user.email,
                  temporaryPassword,
                },
        });
    }
  );
