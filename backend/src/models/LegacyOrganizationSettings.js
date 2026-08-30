import mongoose from 'mongoose';

const { Schema } = mongoose;

/*
 * Backward-compatible Leave Year settings for old/unscoped installations
 * where Users existed before Organization records were introduced.
 *
 * Normal SaaS tenants continue to use Organization.leaveYearStart*.
 */
const legacyOrganizationSettingsSchema = new Schema(
  {
    scopeKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
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
  'LegacyOrganizationSettings',
  legacyOrganizationSettingsSchema
);
