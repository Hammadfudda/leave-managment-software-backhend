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

  // Preserve every LeaveRequest as historical data. Only anonymize the deleted
  // employee's denormalized identity and remove that person from future approval
  // arrays. Pending requests are already auto-cancelled by removeEmployee.
  await LeaveRequest.updateMany(
    { employeeId: user._id },
    {
      $set: {
        employeeName: anonymousName,
        employeeDeleted: true,
        department: user.department || '',
      },
    }
  );

  await LeaveRequest.updateMany(
    {
      $or: [
        { requiredApproverIds: user._id },
        { approvedByIds: user._id },
        { rejectedByIds: user._id },
        { 'approvalHistory.approverId': user._id },
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
      },
    },
    {
      arrayFilters: [{ 'history.approverId': user._id }],
    }
  );

  // Do not overwrite a real admin/manager's cancellation name. If the deleted
  // employee was itself the person who cancelled a historical request, only
  // that cancellation identity is anonymized.
  await LeaveRequest.updateMany(
    { cancelledBy: user._id },
    {
      $set: { cancelledByName: anonymousName },
      $unset: { cancelledBy: '' },
    }
  );

  // LeaveBalance is current-state data, not the historical LeaveRequest record.
  // Notifications are account-state data. Login history is historical activity,
  // so retain it and anonymize the person instead of deleting the record.
  await Promise.all([
    LeaveBalance.deleteMany({ employeeId: user._id }),
    Notification.deleteMany({ userId: user._id }),
    LoginHistory.updateMany(
      { userId: user._id },
      { $set: { userName: anonymousName, userDeleted: true } }
    ),
  ]);

  // Audit history is retained. Separate actor and target anonymization so an
  // audit performed BY this employee does not erase the identity of the person
  // who was affected by that action, and vice versa.
  await AuditLog.updateMany(
    { actorId: user._id },
    {
      $set: { actorName: anonymousName },
      $unset: { actorId: '' },
    }
  );

  await AuditLog.updateMany(
    { targetId: user._id },
    {
      $set: { affectedPerson: anonymousName },
      $unset: { targetId: '' },
    }
  );

  await User.deleteOne({ _id: user._id });

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
