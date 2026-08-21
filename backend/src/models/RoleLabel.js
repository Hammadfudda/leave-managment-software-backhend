import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

/**
 * Spec Part 2.5 — HR label list, separate from the fixed access-control enum.
 * This exists purely so Admin can maintain job-title-style "role" labels for
 * HR/reporting without a code deploy. It has NO bearing on User.role, which
 * stays a fixed three-value enum used for access control.
 */
const roleLabelSchema = new Schema(
  {
    name: { type: String, required: true },
  },
  { timestamps: true }
);

roleLabelSchema.plugin(tenantPlugin);

roleLabelSchema.index(
  {
    organizationId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model('RoleLabel', roleLabelSchema);
