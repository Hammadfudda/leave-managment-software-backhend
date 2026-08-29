import mongoose from 'mongoose';
import { tenantPlugin } from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const yearlyLeaveSnapshotSchema = new Schema(
  {
    leaveYear: {
      type: Number,
      required: true,
      index: true,
    },

    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    employeeCode: {
      type: String,
      default: '',
    },

    employeeName: {
      type: String,
      required: true,
    },

    division: {
      type: String,
      default: '',
    },

    department: {
      type: String,
      default: '',
    },

    designation: {
      type: String,
      default: '',
    },

    grade: {
      type: String,
      default: '',
    },

    leaveType: {
      type: String,
      required: true,
    },

    granted: {
      type: Number,
      default: 0,
    },

    used: {
      type: Number,
      default: 0,
    },

    remaining: {
      type: Number,
      default: 0,
    },

    employeeStatus: {
      type: String,
      default: '',
    },

    detailsStatus: {
      type: String,
      default: '',
    },

    capturedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

yearlyLeaveSnapshotSchema.plugin(tenantPlugin);

yearlyLeaveSnapshotSchema.index(
  {
    organizationId: 1,
    leaveYear: 1,
    employeeId: 1,
    leaveType: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model(
  'YearlyLeaveSnapshot',
  yearlyLeaveSnapshotSchema
);
