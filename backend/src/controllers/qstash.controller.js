import crypto from 'node:crypto';

import CredentialEmailJob from '../models/CredentialEmailJob.js';

import {
  decryptCredentialEmailJob,
  credentialEmailDestinationUrl,
} from '../services/qstashCredentialEmail.service.js';

import {
  sendTemporaryAccountEmail,
} from '../services/temporaryPassword.service.js';

function decodeJwtPayload(
  token
) {
  const parts =
    String(
      token ||
      ''
    ).split(
      '.'
    );

  if (
    parts.length !==
    3
  ) {
    throw new Error(
      'Invalid QStash signature token.'
    );
  }

  return {
    header:
      parts[0],
    payload:
      parts[1],
    signature:
      parts[2],
    claims:
      JSON.parse(
        Buffer.from(
          parts[1],
          'base64url'
        ).toString(
          'utf8'
        )
      ),
  };
}

function signaturesMatch(
  received,
  expected
) {
  const a =
    Buffer.from(
      String(
        received
      )
    );

  const b =
    Buffer.from(
      String(
        expected
      )
    );

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}

function verifyWithKey({
  token,
  signingKey,
  rawBody,
  expectedUrl,
}) {
  if (
    !signingKey
  ) {
    return false;
  }

  const decoded =
    decodeJwtPayload(
      token
    );

  const expectedSignature =
    crypto
      .createHmac(
        'sha256',
        signingKey
      )
      .update(
        `${decoded.header}.${decoded.payload}`
      )
      .digest(
        'base64url'
      );

  if (
    !signaturesMatch(
      decoded.signature,
      expectedSignature
    )
  ) {
    return false;
  }

  const claims =
    decoded.claims;

  const now =
    Math.floor(
      Date.now() /
      1000
    );

  if (
    claims.iss !==
    'Upstash'
  ) {
    return false;
  }

  if (
    String(
      claims.sub ||
      ''
    ).replace(
      /\/+$/,
      ''
    ) !==
    String(
      expectedUrl
    ).replace(
      /\/+$/,
      ''
    )
  ) {
    return false;
  }

  if (
    !Number.isFinite(
      Number(
        claims.exp
      )
    ) ||
    now >
      Number(
        claims.exp
      )
  ) {
    return false;
  }

  if (
    !Number.isFinite(
      Number(
        claims.nbf
      )
    ) ||
    now <
      Number(
        claims.nbf
      )
  ) {
    return false;
  }

  const expectedBodyHash =
    crypto
      .createHash(
        'sha256'
      )
      .update(
        rawBody
      )
      .digest(
        'base64url'
      )
      .replace(
        /=+$/,
        ''
      );

  const receivedBodyHash =
    String(
      claims.body ||
      ''
    ).replace(
      /=+$/,
      ''
    );

  return signaturesMatch(
    receivedBodyHash,
    expectedBodyHash
  );
}

function verifyQstashRequest(
  req
) {
  const signature =
    req.get(
      'Upstash-Signature'
    );

  if (
    !signature
  ) {
    return false;
  }

  const rawBody =
    typeof req.rawBody ===
    'string'
      ? req.rawBody
      : Buffer.isBuffer(
            req.rawBody
          )
        ? req.rawBody.toString(
            'utf8'
          )
        : JSON.stringify(
            req.body ||
            {}
          );

  const expectedUrl =
    credentialEmailDestinationUrl();

  return (
    verifyWithKey({
      token:
        signature,
      signingKey:
        process.env.QSTASH_CURRENT_SIGNING_KEY,
      rawBody,
      expectedUrl,
    }) ||
    verifyWithKey({
      token:
        signature,
      signingKey:
        process.env.QSTASH_NEXT_SIGNING_KEY,
      rawBody,
      expectedUrl,
    })
  );
}

export async function deliverCredentialEmail(
  req,
  res,
  next
) {
  try {
    if (
      !verifyQstashRequest(
        req
      )
    ) {
      return res
        .status(
          401
        )
        .json({
          success:
            false,
          message:
            'Invalid QStash signature.',
        });
    }

    const jobId =
      String(
        req.body?.jobId ||
        ''
      ).trim();

    if (
      !jobId
    ) {
      return res
        .status(
          400
        )
        .json({
          success:
            false,
          message:
            'jobId is required.',
        });
    }

    const existing =
      await CredentialEmailJob.findById(
        jobId
      );

    if (
      !existing
    ) {
      return res
        .status(
          404
        )
        .json({
          success:
            false,
          message:
            'Credential email job does not exist.',
        });
    }

    if (
      existing.status ===
      'sent'
    ) {
      return res.json({
        success:
          true,
        message:
          'Credential email was already sent.',
      });
    }

    const staleBefore =
      new Date(
        Date.now() -
        5 *
          60 *
          1000
      );

    const job =
      await CredentialEmailJob.findOneAndUpdate(
        {
          _id:
            jobId,
          $or: [
            {
              status: {
                $in: [
                  'scheduled',
                  'ready',
                  'schedule_failed',
                ],
              },
            },
            {
              status:
                'processing',
              processingStartedAt: {
                $lte:
                  staleBefore,
              },
            },
          ],
        },
        {
          $set: {
            status:
              'processing',
            processingStartedAt:
              new Date(),
          },
        },
        {
          new:
            true,
        }
      );

    if (
      !job
    ) {
      /*
       * Another delivery is currently processing the same job.
       * Returning 503 tells QStash to retry instead of risking a duplicate.
       */
      return res
        .status(
          503
        )
        .json({
          success:
            false,
          message:
            'Credential email job is already processing.',
        });
    }

    try {
      const payload =
        decryptCredentialEmailJob(
          job
        );

      const sent =
        await sendTemporaryAccountEmail(
          payload
        );

      if (
        !sent
      ) {
        throw new Error(
          'Temporary Password email provider returned an unsuccessful result.'
        );
      }

      /*
       * Keep only a sent tombstone for idempotency. The encrypted Temporary
       * Password payload is removed immediately after successful delivery.
       */
      await CredentialEmailJob.updateOne(
        {
          _id:
            job._id,
        },
        {
          $set: {
            status:
              'sent',
            sentAt:
              new Date(),
            processingStartedAt:
              null,
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

      return res.json({
        success:
          true,
        message:
          'Temporary Password email sent.',
      });
    } catch (error) {
      job.status =
        'scheduled';

      job.processingStartedAt =
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

      throw error;
    }
  } catch (error) {
    next(
      error
    );
  }
}
