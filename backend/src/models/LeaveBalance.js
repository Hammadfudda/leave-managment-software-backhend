import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const leaveBalanceSchema = new Schema(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    leaveType: {
      type: String,
      required: true,
    },

    quota: {
      type: Number,
      required: true,
      default: 0,
    },

    used: {
      type: Number,
      required: true,
      default: 0,
    },

    year: {
      type: Number,
      default: () =>
        new Date().getFullYear(),
    },
  },
  {
    timestamps: true,
  }
);

leaveBalanceSchema.plugin(
  tenantPlugin
);

leaveBalanceSchema.index(
  {
    organizationId: 1,
    employeeId: 1,
    leaveType: 1,
    year: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model(
  'LeaveBalance',
  leaveBalanceSchema
);
