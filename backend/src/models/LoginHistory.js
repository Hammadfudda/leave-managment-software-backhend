import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const loginHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    ipAddress: String,
    userAgent: String,

    successful: {
      type: Boolean,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

loginHistorySchema.plugin(
  tenantPlugin
);

loginHistorySchema.index({
  organizationId: 1,
  userId: 1,
  createdAt: -1,
});

export default mongoose.model(
  'LoginHistory',
  loginHistorySchema
);
