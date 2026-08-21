import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    actorName: String,

    action: {
      type: String,
      required: true,
    },

    targetType: String,
    targetId: Schema.Types.ObjectId,
    details: String,
    affectedPerson: String,
    department: String,
    leaveType: String,
    comment: String,
  },
  {
    timestamps: true,
  }
);

auditLogSchema.plugin(
  tenantPlugin
);

auditLogSchema.index({
  organizationId: 1,
  createdAt: -1,
});

auditLogSchema.index({
  organizationId: 1,
  actorId: 1,
});

export default mongoose.model(
  'AuditLog',
  auditLogSchema
);
