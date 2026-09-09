import crypto from 'node:crypto';

import CredentialEmailJob from '../models/CredentialEmailJob.js';

import {
  sendTemporaryAccountEmail,
} from './temporaryPassword.service.js';

function encryptionKey() {
  const source =
    process.env.QSTASH_PAYLOAD_SECRET ||
    process.env.JWT_ACCESS_SECRET;

  if (!source) {
    throw new Error(
      'QSTASH_PAYLOAD_SECRET or JWT_ACCESS_SECRET is required.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(source)
    .digest();
}

function encryptPayload(payload) {
  const iv =
    crypto.randomBytes(12);

  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      encryptionKey(),
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        JSON.stringify(payload),
        'utf8'
      ),
      cipher.final(),
    ]);

  return {
    encryptedPayload:
      encrypted.toString('base64'),
    iv:
      iv.toString('base64'),
    authTag:
      cipher
        .getAuthTag()
        .toString('base64'),
  };
}

export function decryptCredentialEmailJob(job) {
  const decipher =
    crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(
        job.iv,
        'base64'
      )
    );

  decipher.setAuthTag(
    Buffer.from(
      job.authTag,
      'base64'
    )
  );

  const decrypted =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          job.encryptedPayload,
          'base64'
        )
      ),
      decipher.final(),
    ]);

  return JSON.parse(
    decrypted.toString('utf8')
  );
}

/*
 * Kept for backward compatibility with the existing QStash controller/routes.
 * New Smart CSV imports no longer depend on this URL for credential delivery.
 */
function backendBaseUrl() {
  const explicit =
    String(
      process.env.BACKEND_PUBLIC_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, '');

  if (explicit) {
    return explicit;
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (vercelHost) {
    return `https://${String(vercelHost)
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')}`;
  }

  return 'http://localhost:5000';
}

export function credentialEmailDestinationUrl() {
  return `${backendBaseUrl()}/api/internal/qstash/credential-email`;
}

export async function createCredentialEmailJobs({
  items,
  session,
}) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return [];
  }

  const docs =
    items.map((item) => ({
      userId:
        item.userId,
      ...encryptPayload({
        to:
          item.to,
        fullName:
          item.fullName,
        roleLabel:
          item.roleLabel,
        temporaryPassword:
          item.temporaryPassword,
      }),
      status:
        'ready',
    }));

  return CredentialEmailJob.insertMany(
    docs,
    {
      session,
    }
  );
}

/*
 * DIRECT GMAIL MODE
 *
 * The Smart CSV controller already calls this function only AFTER the MongoDB
 * import transaction has committed. Instead of publishing to QStash, send the
 * temporary-password email immediately through the existing Nodemailer/Gmail
 * SMTP service.
 *
 * Email failure never rolls back the employee import. Failed jobs keep their
 * encrypted payload and are marked schedule_failed for inspection.
 */
export async function scheduleCredentialEmailJobs(jobIds) {
  if (
    !Array.isArray(jobIds) ||
    jobIds.length === 0
  ) {
    return {
      scheduled: 0,
      failed: 0,
      errors: [],
    };
  }

  const jobs =
    await CredentialEmailJob.find({
      _id: {
        $in: jobIds,
      },
      status: {
        $in: [
          'ready',
          'schedule_failed',
          'scheduled',
        ],
      },
    }).sort({
      createdAt: 1,
    });

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const job of jobs) {
    try {
      job.status =
        'processing';
      job.processingStartedAt =
        new Date();
      job.scheduleError =
        '';

      await job.save();

      const payload =
        decryptCredentialEmailJob(job);

      console.info(
        '[Smart CSV Email] direct Gmail send attempt',
        {
          jobId:
            String(job._id),
          to:
            payload.to,
        }
      );

      const ok =
        await sendTemporaryAccountEmail(
          payload
        );

      if (!ok) {
        throw new Error(
          'Gmail SMTP returned an unsuccessful result.'
        );
      }

      /*
       * Keep a sent tombstone only. Remove the encrypted temporary-password
       * payload immediately after successful delivery.
       */
      await CredentialEmailJob.updateOne(
        {
          _id: job._id,
        },
        {
          $set: {
            status:
              'sent',
            sentAt:
              new Date(),
            processingStartedAt:
              null,
            scheduledFor:
              null,
            qstashMessageId:
              '',
            scheduleError:
              '',
          },
          $unset: {
            encryptedPayload:
              1,
            iv:
              1,
            authTag:
              1,
          },
        }
      );

      console.info(
        '[Smart CSV Email] direct Gmail send success',
        {
          jobId:
            String(job._id),
          to:
            payload.to,
        }
      );

      sent += 1;
    } catch (error) {
      const message =
        (
          error instanceof Error
            ? error.message
            : String(error)
        ).slice(0, 1000);

      await CredentialEmailJob.updateOne(
        {
          _id: job._id,
        },
        {
          $set: {
            status:
              'schedule_failed',
            processingStartedAt:
              null,
            scheduledFor:
              null,
            qstashMessageId:
              '',
            scheduleError:
              message,
          },
        }
      );

      console.error(
        '[Smart CSV Email] direct Gmail send failed',
        {
          jobId:
            String(job._id),
          error:
            message,
        }
      );

      errors.push({
        jobId:
          String(job._id),
        message,
      });

      failed += 1;
    }
  }

  /*
   * Keep the existing controller response contract:
   * "scheduled" now means successfully SENT directly by Gmail.
   */
  return {
    scheduled:
      sent,
    failed,
    errors,
  };
}

/*
 * IMPORTANT SAFETY:
 * Old pending QStash jobs are deliberately NOT auto-sent.
 *
 * SmartCsvImportEnhancer calls /retry-emails automatically on page load.
 * Sending every historical pending job here could email old test/client
 * accounts unexpectedly. Fresh CSV imports are already delivered directly
 * because commitSmartCsv passes only their newly-created job IDs into
 * scheduleCredentialEmailJobs().
 */
export async function retryPendingCredentialEmailJobs() {
  console.info(
    '[Smart CSV Email] automatic historical retry skipped in direct Gmail mode'
  );

  return {
    scheduled: 0,
    failed: 0,
    errors: [],
  };
}
