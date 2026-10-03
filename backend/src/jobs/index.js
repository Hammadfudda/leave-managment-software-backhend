import cron from 'node-cron';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { audit } from '../utils/audit.js';
import { emailAdmins } from '../services/notification.service.js';
import { purgeEmployeeData, purgeOrganizationData, RESTORE_WINDOW_DAYS } from '../services/deletion.service.js';

/**
 * Deleted employee accounts and organizations remain restorable for 10 days.
 * Once scheduledPurgeAt passes, the scheduled purge permanently removes the
 * account/tenant data that belongs to the deleted subject.
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
    // The employee's historical identity has already been anonymized by
    // purgeEmployeeData. Keep the purge audit entry anonymized too.
    if (snapshot.removedBy) {
      await audit({
        actorId: snapshot.removedBy,
        actorName: 'System',
        action: 'PURGE_EMPLOYEE',
        targetType: 'User',
        affectedPerson: 'Former Employee',
        department: snapshot.department,
        details: `Employee account permanently deleted after the ${RESTORE_WINDOW_DAYS}-day restore window expired; historical records retained and anonymized.`,
      });
    }
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
