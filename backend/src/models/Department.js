import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const departmentSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },

    /*
     * User-visible organizational parent.
     * Stored by name so the existing RoleLabel/Division master-data records
     * remain backward compatible without a risky migration.
     */
    divisionName: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    // false = this department works a 6-day week.
    saturdayOff: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

departmentSchema.plugin(
  tenantPlugin
);

departmentSchema.index(
  {
    organizationId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

departmentSchema.index({
  organizationId: 1,
  divisionName: 1,
});

export default mongoose.model(
  'Department',
  departmentSchema
);
