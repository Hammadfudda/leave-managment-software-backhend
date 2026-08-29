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
      ],
      default: 'active',
      index: true,
    },

    adminUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
