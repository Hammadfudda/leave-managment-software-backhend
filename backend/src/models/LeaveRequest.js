import mongoose from 'mongoose';

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

    /* =====================================================
       PRIVATE CLOUDINARY ATTACHMENT

       Important:
       - permanent public URL store nahi hoti
       - sirf Cloudinary asset metadata store hota hai
       - authorized user ke liye backend temporary URL banayega
    ===================================================== */

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

      enum: [
        'image',
        'raw',
      ],

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

    /* =====================================================
       STATUS
    ===================================================== */

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

    /* =====================================================
       APPROVAL ROUTING
    ===================================================== */

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

        approverName: {
          type: String,
        },

        approverRole: {
          type: String,
        },

        action: {
          type: String,

          enum: [
            'approved',
            'rejected',
            'cancelled',
          ],
        },

        comment: {
          type: String,
        },

        actionDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    /* =====================================================
       EXTENSION
    ===================================================== */

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

    /* =====================================================
       STOP LEAVE / CANCELLATION
    ===================================================== */

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

/* =========================================================
   INDEXES
========================================================= */

leaveRequestSchema.index({
  employeeId: 1,
  status: 1,
});

leaveRequestSchema.index({
  requiredApproverIds: 1,
  status: 1,
});

leaveRequestSchema.index({
  originalRequestId: 1,
});

leaveRequestSchema.index({
  isAdminOnlyDecision: 1,
  status: 1,
});

export default mongoose.model(
  'LeaveRequest',
  leaveRequestSchema
);