import mongoose from 'mongoose';

const { Schema } = mongoose;

const organizationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'active',
        'suspended',
        'pending_deletion',
      ],
      default: 'active',
      index: true,
    },

    adminUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    scheduledPurgeAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperAdmin',
      default: null,
    },

    createdBySuperAdminId: {
      type: Schema.Types.ObjectId,
      ref: 'SuperAdmin',
      required: true,
    },

    leaveYearStartMonth: {
      type: Number,
      min: 1,
      max: 12,
      default: 1,
    },

    leaveYearStartDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  'Organization',
  organizationSchema
);
