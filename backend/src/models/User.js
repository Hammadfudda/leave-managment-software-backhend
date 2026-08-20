import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.1
const userSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // CNIC — also the default login password for a completed employee.
    // Pending CSV employees receive a unique temporary nationalId until Admin
    // fixes their real CNIC.
    nationalId: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    passwordChangedFromDefault: { type: Boolean, default: false },

    role: { type: String, enum: ['admin', 'manager', 'employee'], required: true },

    // These fields stay strictly validated by the normal Create Employee
    // controller. They are nullable here only so a CSV record can be imported
    // as "Details Pending" and completed by Admin later.
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    canApproveOtherDepartments: { type: Boolean, default: false },

    employeeId: { type: String, required: true, unique: true },

    cnic: { type: String, default: '' },
    designation: { type: String, default: '' },
    department: { type: String, default: '' },
    phone: { type: String },
    dateOfJoining: { type: Date, default: null },

    detailsStatus: {
      type: String,
      enum: ['complete', 'pending'],
      default: 'complete',
      index: true,
    },

    pendingFields: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ['active', 'inactive', 'pending_deletion'],
      default: 'active',
    },

    deactivatedAt: { type: Date, default: null },
    scheduledPurgeAt: { type: Date, default: null },
    removedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    profilePhotoUrl: { type: String },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    refreshTokenHash: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },

    // Password reset
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ managerId: 1 });
userSchema.index({ department: 1 });

export default mongoose.model('User', userSchema);
