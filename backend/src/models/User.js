import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.1
const userSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // CNIC — also the default login password
    nationalId: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true }, // bcrypt(nationalId) at creation
    passwordChangedFromDefault: { type: Boolean, default: false },

    role: { type: String, enum: ['admin', 'manager', 'employee'], required: true },
    // NOTE: There is no "team_leader" role. Any senior person who needs to approve
    // leave (e.g. a department head or "Chief") is simply given role: 'manager'.

    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Manager-only. Controls whether this person can be selected as a required
    // approver on Leave Policies belonging to departments other than their own.
    // Default false — Admin must explicitly grant this per manager.
    canApproveOtherDepartments: { type: Boolean, default: false },

    employeeId: { type: String, required: true, unique: true }, // e.g. "NDD-004"
    cnic: { type: String, required: true },
    designation: { type: String, required: true },
    department: { type: String, required: true },
    phone: { type: String },
    dateOfJoining: { type: Date, required: true },

    status: { type: String, enum: ['active', 'inactive', 'pending_deletion'], default: 'active' },
    deactivatedAt: { type: Date, default: null },
    scheduledPurgeAt: { type: Date, default: null }, // deactivatedAt + 7 days
    removedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    profilePhotoUrl: { type: String },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    refreshTokenHash: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },

    // Password reset (Part 11 — /auth/forgot-password, /auth/reset-password)
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

// NOTE: email/nationalId/employeeId already get unique indexes from their field
// definitions above — re-declaring email here caused a duplicate-index warning.
userSchema.index({ managerId: 1 });
userSchema.index({ department: 1 });

export default mongoose.model('User', userSchema);
