import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const credentialEmailJobSchema =
  new Schema(
    {
      userId: {
        type:
          Schema.Types.ObjectId,
        ref:
          'User',
        required:
          true,
        index:
          true,
      },

      encryptedPayload: {
        type:
          String,
        default:
          null,
        required() {
          return this.status !==
            'sent';
        },
      },

      iv: {
        type:
          String,
        default:
          null,
        required() {
          return this.status !==
            'sent';
        },
      },

      authTag: {
        type:
          String,
        default:
          null,
        required() {
          return this.status !==
            'sent';
        },
      },

      status: {
        type:
          String,
        enum: [
          'ready',
          'scheduled',
          'processing',
          'sent',
          'schedule_failed',
        ],
        default:
          'ready',
        index:
          true,
      },

      scheduledFor: {
        type:
          Date,
        default:
          null,
        index:
          true,
      },

      qstashMessageId: {
        type:
          String,
        default:
          '',
      },

      scheduleError: {
        type:
          String,
        default:
          '',
      },

      processingStartedAt: {
        type:
          Date,
        default:
          null,
      },

      sentAt: {
        type:
          Date,
        default:
          null,
      },
    },
    {
      timestamps:
        true,
    }
  );

credentialEmailJobSchema.plugin(
  tenantPlugin
);

credentialEmailJobSchema.index({
  organizationId:
    1,
  status:
    1,
  createdAt:
    1,
});

export default mongoose.model(
  'CredentialEmailJob',
  credentialEmailJobSchema
);
