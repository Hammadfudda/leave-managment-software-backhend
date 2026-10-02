import mongoose from 'mongoose';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import LeaveRequest from '../models/LeaveRequest.js';
import LeaveBalance from '../models/LeaveBalance.js';
import Notification from '../models/Notification.js';
import LoginHistory from '../models/LoginHistory.js';
import AuditLog from '../models/AuditLog.js';

export const RESTORE_WINDOW_DAYS = 10;

export async function purgeEmployeeData(userId) {
  const user = await User.findById(userId);
  if (!user) return false;

  const anonymousName = 'Former Employee';
  const userIdFilter = { $in: [user._id] };

  // Preserve leave history and approval/audit records. The person's identity is
  // anonymized instead of deleting historical documents.
  await Promise.all([
    LeaveRequest.updateMany(
      { employeeId: user._id },
      {
        $set: {
          employeeName: anonymousName,
          employeeDeleted: true,
          department: user.department || '',
        },
      }
    ),
    LeaveRequest.updateMany(
      {
        $or: [
          { requiredApproverIds: userIdFilter },
          { approvedByIds: userIdFilter },
          { rejectedByIds: userIdFilter },
          { 'approvalHistory.approverId': user._id },
          { cancelledBy: user._id },
        ],
      },
      {
        $pull: {
          requiredApproverIds: user._id,
          approvedByIds: user._id,
          rejectedByIds: user._id,
        },
        $set: {
          'approvalHistory.$[history].approverName': anonymousName,
          cancelledByName: anonymousName,
        },
      },
      {
        arrayFilters: [{ 'history.approverId': user._id }],
      }
    ),
    LeaveBalance.deleteMany({ employeeId: user._id }),
    Notification.deleteMany({ userId: user._id }),
    LoginHistory.deleteMany({ userId: user._id }),
    AuditLog.updateMany(
      {
        $or: [
          { actorId: user._id },
          { targetId: user._id },
        ],
      },
      {
        $set: {
          actorName: anonymousName,
          affectedPerson: anonymousName,
        },
        $unset: {
          actorId: '',
          targetId: '',
        },
      }
    ),
    User.deleteOne({ _id: user._id }),
  ]);

  return true;
}

export async function purgeOrganizationData(organizationId) {
  const organization = await Organization.findById(organizationId);
  if (!organization) return null;

  const tenantUserIds = await User.find({
    organizationId: organization._id,
  }).distinct('_id');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not ready.');
  }

  const userIdFilter = { $in: tenantUserIds };

  await Promise.all([
    LeaveRequest.deleteMany({
      $or: [
        { employeeId: userIdFilter },
        { requiredApproverIds: userIdFilter },
        { approvedByIds: userIdFilter },
        { rejectedByIds: userIdFilter },
        { cancelledBy: userIdFilter },
      ],
    }),
    LeaveBalance.deleteMany({ employeeId: userIdFilter }),
    Notification.deleteMany({ userId: userIdFilter }),
    LoginHistory.deleteMany({ userId: userIdFilter }),
    AuditLog.deleteMany({ actorId: userIdFilter }),
    FeedbackRequest.deleteMany({ organizationId: organization._id }),
    User.deleteMany({ organizationId: organization._id }),
  ]);

  const excluded = new Set(['organizations', 'superadmins']);
  let deletedTenantRecords = 0;

  for (const item of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (excluded.has(item.name) || item.name.startsWith('system.')) {
      continue;
    }

    const result = await db
      .collection(item.name)
      .deleteMany({ organizationId: organization._id });

    deletedTenantRecords += result.deletedCount || 0;
  }

  await Organization.deleteOne({ _id: organization._id });

  return {
    organizationName: organization.name,
    deletedUsers: tenantUserIds.length,
    deletedTenantRecords,
  };
}
