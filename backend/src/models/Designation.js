import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

// Spec Part 2.4
const designationSchema = new Schema(
  {
    name: { type: String, required: true },
  },
  { timestamps: true }
);

designationSchema.plugin(tenantPlugin);

designationSchema.index(
  {
    organizationId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model('Designation', designationSchema);
