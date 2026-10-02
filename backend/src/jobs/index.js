import cron from 'node-cron';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import LeaveBalance from '../models/LeaveBalance.js';
import Notification from '../models/Notification.js';
import { audit } from '../utils/audit.js';
import { emailAdmins } from '../services/notification.service.js';
import { purgeEmployeeData, purgeOrganizationData, RESTORE_WINDOW_DAYS } from '../services/deletion.service.js';

/**
 * Spec Part 4 — a removed employee sits in `pending_deletion` for 7 days and
 * can be restored during that window. Once scheduledPurgeAt passes, the record
 * and everything personal attached to it is permanently deleted.
 *
 * LeaveRequests are deliberately NOT deleted: they are part of the approval
 * record other people acted on, and audit logs reference them.
 */
export async function purgeExpiredEmployees() {
  const now = new Date();
  const due = await User.find({
    status: 'pending_deletion',
    scheduledPurgeAt: { $lte: now },
  });

  for (const user of due) {
    const snapshot = {
      id: user._id, fullName: user.fullName, employeeId: user.employeeId,
      department: user.department, removedBy: user.removedBy || null,
    };
    await purgeEmployeeData(user._id);
    await audit({
      actorId: snapshot.removedBy, actorName: 'System', action: 'PURGE_EMPLOYEE',
      targetType: 'User', targetId: snapshot.id, affectedPerson: snapshot.fullName,
      department: snapshot.department,
      details: `Permanently deleted after the ${RESTORE_WINDOW_DAYS}-day restore window expired`,
    });
    await emailAdmins(
      'Employee permanently deleted',
      `${snapshot.fullName} (${snapshot.employeeId}) was permanently deleted after the ${RESTORE_WINDOW_DAYS}-day restore window expired.`
    );
  }

  const organizations = await Organization.find({
    status: 'pending_deletion',
    scheduledPurgeAt: { $lte: now },
  }).select('_id name');

  for (const organization of organizations) {
    const result = await purgeOrganizationData(organization._id);
    if (result) {
      console.log(`Permanently purged organization "${organization.name}" after the ${RESTORE_WINDOW_DAYS}-day restore window expired.`);
    }
  }

  if (due.length || organizations.length) {
    console.log(`Purge completed: ${due.length} employee account(s), ${organizations.length} organization(s).`);
  }
  return { employees: due.length, organizations: organizations.length };
}

export function startCrons() {
  // 02:00 every night, server local time.
  cron.schedule('0 2 * * *', () => {
    purgeExpiredEmployees().catch((err) => console.error('Purge job failed:', err.message));
  });
  console.log('Scheduled nightly purge job (02:00) for expired employee accounts and organizations.');
}
