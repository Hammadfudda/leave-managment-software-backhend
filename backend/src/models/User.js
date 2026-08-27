import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // CNIC / nationalId is identity data only.
    // New accounts use a random temporary password, never CNIC as password.
    nationalId: {
      type: String,
      required: true,
      unique: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    /*
     * Legacy compatibility flag already used by forgot/reset-password flow.
     * New mandatory first-login behavior uses mustChangePassword below so
     * existing users are not unexpectedly forced to change passwords.
     */
    passwordChangedFromDefault: {
      type: Boolean,
      default: false,
    },

    /*
     * Explicit mandatory password-change gate.
     * Existing database users safely default to false.
     * Only accounts issued a Temporary Password are set to true.
     */
    mustChangePassword: {
      type: Boolean,
      default: false,
      index: true,
    },

    /*
     * ACCESS-CONTROL ROLE.
     * This remains fixed and must never be confused with roleLabel below.
     */
    role: {
      type: String,
      enum: [
        'admin',
        'manager',
        'employee',
      ],
      required: true,
    },

    /*
     * HR / MASTER DATA ROLE.
     *
     * Examples:
     * Software Engineer, Team Lead, Accountant, HR Officer.
     *
     * This has no effect on authentication or authorization.
     * Existing users safely default to an empty value.
     */
    roleLabel: {
      type: String,
      trim: true,
      default: '',
    },

    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },

    gradeId: {
      type: Schema.Types.ObjectId,
      ref: 'Grade',
      default: null,
    },

    managerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    canApproveOtherDepartments: {
      type: Boolean,
      default: false,
    },

    employeeId: {
      type: String,
      required: true,
      unique: true,
    },

    cnic: {
      type: String,
      default: '',
    },

    designation: {
      type: String,
      default: '',
    },

    department: {
      type: String,
      default: '',
    },

    phone: {
      type: String,
    },

    dateOfJoining: {
      type: Date,
      default: null,
    },

    detailsStatus: {
      type: String,
      enum: [
        'complete',
        'pending',
      ],
      default: 'complete',
      index: true,
    },

    pendingFields: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: [
        'active',
        'inactive',
        'pending_deletion',
      ],
      default: 'active',
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    scheduledPurgeAt: {
      type: Date,
      default: null,
    },

    removedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    profilePhotoUrl: {
      type: String,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockedUntil: {
      type: Date,
      default: null,
    },

    refreshTokenHash: {
      type: String,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    passwordResetTokenHash: {
      type: String,
      default: null,
    },

    passwordResetExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.plugin(
  tenantPlugin
);

userSchema.index({
  organizationId: 1,
  managerId: 1,
});

userSchema.index({
  organizationId: 1,
  department: 1,
});

userSchema.index({
  organizationId: 1,
  role: 1,
  status: 1,
});

userSchema.index({
  organizationId: 1,
  roleLabel: 1,
});

export default mongoose.model(
  'User',
  userSchema
);
