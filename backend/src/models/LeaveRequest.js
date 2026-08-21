import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const leaveRequestSchema = new Schema(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    employeeName: {
      type: String,
      required: true,
    },

    department: {
      type: String,
      required: true,
    },

    leaveType: {
      type: String,
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    totalDaysRequested: {
      type: Number,
      required: true,
    },

    totalWorkingDays: {
      type: Number,
      required: true,
    },

    excludedWeekendDates: [
      {
        type: String,
      },
    ],

    reason: {
      type: String,
      required: true,
    },

    attachmentName: {
      type: String,
      default: null,
    },

    attachmentPublicId: {
      type: String,
      default: null,
    },

    attachmentResourceType: {
      type: String,
      enum: ['image', 'raw'],
      default: null,
    },

    attachmentFormat: {
      type: String,
      default: null,
    },

    attachmentBytes: {
      type: Number,
      default: null,
    },

    attachmentMimeType: {
      type: String,
      default: null,
    },

    attachmentVersion: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'rejected',
        'cancelled',
      ],
      default: 'pending',
    },

    requiredApproverIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    approvedByIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    rejectedByIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    isAdminOnlyDecision: {
      type: Boolean,
      default: false,
    },

    approvalHistory: [
      {
        approverId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },

        approverName: String,
        approverRole: String,

        action: {
          type: String,
          enum: [
            'approved',
            'rejected',
            'cancelled',
          ],
        },

        comment: String,

        actionDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    isExtension: {
      type: Boolean,
      default: false,
    },

    originalRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveRequest',
      default: null,
    },

    isPaidOverride: {
      type: Boolean,
      default: null,
    },

    isStopRequest: {
      type: Boolean,
      default: false,
    },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    cancelledByName: {
      type: String,
      default: null,
    },

    cancelledReason: {
      type: String,
      default: null,
    },

    daysUsedBeforeCancel: {
      type: Number,
      default: null,
    },

    actualEndDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

leaveRequestSchema.plugin(
  tenantPlugin
);

leaveRequestSchema.index({
  organizationId: 1,
  employeeId: 1,
  status: 1,
});

leaveRequestSchema.index({
  organizationId: 1,
  requiredApproverIds: 1,
  status: 1,
});

leaveRequestSchema.index({
  organizationId: 1,
  originalRequestId: 1,
});

leaveRequestSchema.index({
  organizationId: 1,
  isAdminOnlyDecision: 1,
  status: 1,
});

export default mongoose.model(
  'LeaveRequest',
  leaveRequestSchema
);
