import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

// Spec Part 2.3
const departmentSchema = new Schema(
  {
    name: { type: String, required: true },
    // false = this department works a 6-day week (Saturday is a normal working day).
    // Default true = standard 5-day week (Saturday off, same as Sunday).
    saturdayOff: { type: Boolean, default: true },
  },
  { timestamps: true }
);

departmentSchema.plugin(tenantPlugin);

departmentSchema.index(
  {
    organizationId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model('Department', departmentSchema);
