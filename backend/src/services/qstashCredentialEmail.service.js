import crypto from 'node:crypto';

import CredentialEmailJob from '../models/CredentialEmailJob.js';

const THIRTY_SECONDS =
  30 * 1000;

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
    .createHash(
      'sha256'
    )
    .update(
      source
    )
    .digest();
}

function encryptPayload(
  payload
) {
  const iv =
    crypto.randomBytes(
      12
    );

  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      encryptionKey(),
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        JSON.stringify(
          payload
        ),
        'utf8'
      ),
      cipher.final(),
    ]);

  return {
    encryptedPayload:
      encrypted.toString(
        'base64'
      ),
    iv:
      iv.toString(
        'base64'
      ),
    authTag:
      cipher
        .getAuthTag()
        .toString(
          'base64'
        ),
  };
}

export function decryptCredentialEmailJob(
  job
) {
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
    decrypted.toString(
      'utf8'
    )
  );
}

function qstashBaseUrl() {
  return String(
    process.env.QSTASH_URL ||
    'https://qstash.upstash.io'
  ).replace(
    /\/+$/,
    ''
  );
}

function backendBaseUrl() {
  const explicit =
    String(
      process.env.BACKEND_PUBLIC_URL ||
      ''
    )
      .trim()
      .replace(
        /\/+$/,
        ''
      );

  if (explicit) {
    return explicit;
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (vercelHost) {
    return `https://${String(vercelHost).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }

  throw new Error(
    'BACKEND_PUBLIC_URL is required outside Vercel.'
  );
}

export function credentialEmailDestinationUrl() {
  return `${backendBaseUrl()}/api/internal/qstash/credential-email`;
}

function requiredQstashEnv() {
  const missing =
    [
      'QSTASH_TOKEN',
      'QSTASH_CURRENT_SIGNING_KEY',
      'QSTASH_NEXT_SIGNING_KEY',
    ].filter(
      (key) =>
        !process.env[key]
    );

  if (
    missing.length
  ) {
    throw new Error(
      `Missing QStash environment variables: ${missing.join(', ')}`
    );
  }
}

export async function createCredentialEmailJobs({
  items,
  session,
}) {
  if (
    !Array.isArray(
      items
    ) ||
    items.length ===
      0
  ) {
    return [];
  }

  const docs =
    items.map(
      (item) => ({
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
      })
    );

  return CredentialEmailJob.insertMany(
    docs,
    {
      session,
    }
  );
}

async function publishJob(
  job,
  delaySeconds
) {
  requiredQstashEnv();

  const destination =
    credentialEmailDestinationUrl();

  const publishUrl =
    `${qstashBaseUrl()}/v2/publish/${destination}`;

  const response =
    await fetch(
      publishUrl,
      {
        method:
          'POST',
        headers: {
          Authorization:
            `Bearer ${process.env.QSTASH_TOKEN}`,
          'Content-Type':
            'application/json',
          'Upstash-Delay':
            `${Math.max(0, delaySeconds)}s`,
          'Upstash-Deduplication-Id':
            `credential-email-${job._id}`,
        },
        body:
          JSON.stringify({
            jobId:
              String(
                job._id
              ),
          }),
      }
    );

  let payload =
    null;

  try {
    payload =
      await response.json();
  } catch {
    payload =
      null;
  }

  if (
    !response.ok
  ) {
    throw new Error(
      payload?.error ||
      payload?.message ||
      `QStash publish failed with HTTP ${response.status}.`
    );
  }

  return payload;
}

export async function scheduleCredentialEmailJobs(
  jobIds
) {
  if (
    !Array.isArray(
      jobIds
    ) ||
    jobIds.length ===
      0
  ) {
    return {
      scheduled:
        0,
      failed:
        0,
    };
  }

  const jobs =
    await CredentialEmailJob.find({
      _id: {
        $in:
          jobIds,
      },
      status: {
        $in: [
          'ready',
          'schedule_failed',
        ],
      },
    }).sort({
      createdAt:
        1,
    });

  if (
    jobs.length ===
      0
  ) {
    return {
      scheduled:
        0,
      failed:
        0,
    };
  }

  /*
   * Keep one continuous 30-second lane per tenant.
   *
   * This also fixes retries: a failed job never jumps back to delay 0 while
   * another credential email is already scheduled in the future.
   */
  const latestScheduled =
    await CredentialEmailJob.findOne({
      _id: {
        $nin:
          jobs.map(
            (job) =>
              job._id
          ),
      },
      status: {
        $in: [
          'scheduled',
          'processing',
        ],
      },
      scheduledFor: {
        $ne:
          null,
      },
    })
      .sort({
        scheduledFor:
          -1,
      })
      .select(
        'scheduledFor'
      )
      .lean();

  const now =
    Date.now();

  let nextSlot =
    now;

  if (
    latestScheduled
      ?.scheduledFor
  ) {
    nextSlot =
      Math.max(
        nextSlot,
        new Date(
          latestScheduled.scheduledFor
        ).getTime() +
          THIRTY_SECONDS
      );
  }

  let scheduled =
    0;

  let failed =
    0;

  for (
    const job of
    jobs
  ) {
    const scheduledFor =
      new Date(
        nextSlot
      );

    const delaySeconds =
      Math.max(
        0,
        Math.ceil(
          (
            scheduledFor.getTime() -
            Date.now()
          ) /
            1000
        )
      );

    try {
      const result =
        await publishJob(
          job,
          delaySeconds
        );

      job.status =
        'scheduled';

      job.scheduledFor =
        scheduledFor;

      job.qstashMessageId =
        String(
          result?.messageId ||
          ''
        );

      job.scheduleError =
        '';

      await job.save();

      scheduled +=
        1;

      nextSlot =
        scheduledFor.getTime() +
        THIRTY_SECONDS;
    } catch (error) {
      job.status =
        'schedule_failed';

      job.scheduledFor =
        null;

      job.scheduleError =
        (
          error instanceof Error
            ? error.message
            : String(
                error
              )
        ).slice(
          0,
          1000
        );

      await job.save();

      failed +=
        1;

      /*
       * A failed publish did not reserve a real QStash slot, so the next
       * successful job may use the same slot without breaking send spacing.
       */
    }
  }

  return {
    scheduled,
    failed,
  };
}

export async function retryPendingCredentialEmailJobs() {
  const jobs =
    await CredentialEmailJob.find({
      status: {
        $in: [
          'ready',
          'schedule_failed',
        ],
      },
    })
      .select(
        '_id'
      )
      .sort({
        createdAt:
          1,
      });

  return scheduleCredentialEmailJobs(
    jobs.map(
      (job) =>
        job._id
    )
  );
}
