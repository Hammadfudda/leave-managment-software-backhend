import cron from 'node-cron';
import User from '../models/User.js';
import LeaveBalance from '../models/LeaveBalance.js';
import Notification from '../models/Notification.js';
import { audit } from '../utils/audit.js';
import { emailAdmins } from '../services/notification.service.js';

/**
 * Spec Part 4 — a removed employee sits in `pending_deletion` for 7 days and
 * can be restored during that window. Once scheduledPurgeAt passes, the record
 * and everything personal attached to it is permanently deleted.
 *
 * LeaveRequests are deliberately NOT deleted: they are part of the approval
 * record other people acted on, and audit logs reference them.
 */
export async function purgeExpiredEmployees() {
  const due = await User.find({
    status: 'pending_deletion',
    scheduledPurgeAt: { $lte: new Date() },
  });

  for (const user of due) {
    await LeaveBalance.deleteMany({ employeeId: user._id });
    await Notification.deleteMany({ userId: user._id });
    await user.deleteOne();

    await audit({
      actorId: user.removedBy || null,
      actorName: 'System',
      action: 'PURGE_EMPLOYEE',
      targetType: 'User',
      targetId: user._id,
      affectedPerson: user.fullName,
      department: user.department,
      details: 'Permanently deleted after the 7-day restore window expired',
    });

    await emailAdmins(
      'Employee permanently deleted',
      `${user.fullName} (${user.employeeId}) was permanently deleted after the 7-day restore window expired.`
    );
  }

  if (due.length) console.log(`Purged ${due.length} expired employee record(s).`);
  return due.length;
}

export function startCrons() {
  // 02:00 every night, server local time.
  cron.schedule('0 2 * * *', () => {
    purgeExpiredEmployees().catch((err) => console.error('Purge job failed:', err.message));
  });
  console.log('Scheduled nightly purge job (02:00).');
}
