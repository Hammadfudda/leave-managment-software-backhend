import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendEmail, templates } from './email.service.js';
import { getCurrentTurnApproverIds } from './approvalChain.js';

/**
 * Spec Part 8 — every notification-worthy action creates a Notification row and
 * sends an email. Email is a side effect: a failed send is recorded on the
 * notification (emailSent: false) and never rolls back the underlying action.
 */
export async function notify({ userId, type, message, relatedLeaveRequestId, email }) {
  const notification = await Notification.create({
    userId,
    type,
    message,
    relatedLeaveRequestId,
  });

  if (email) {
    const sent = await sendEmail(email);
    if (sent) {
      notification.emailSent = true;
      await notification.save();
    }
  }
  return notification;
}

function labelFor(type) {
  return type === 'extension_requested'
    ? 'extension request'
    : type === 'stop_requested'
      ? 'request to end leave early'
      : 'leave request';
}

/**
 * ADDENDUM 2.1/2.2 — an admin-only leave type has no gatekeeper individual, so
 * the email goes to the SHARED admin address (COMPANY_ADMIN_NOTIFICATION_EMAIL)
 * rather than any one admin's personal inbox. In-app notifications are still
 * created for every active admin so it shows up in whoever's list view.
 */
export async function notifyAdminsOfAdminOnlyRequest(request, type = 'leave_pending_approval') {
  const label = labelFor(type);
  const message = `${request.employeeName} submitted a ${request.leaveType} ${label} that requires a direct Admin decision.`;
  const subject = `Admin decision required: ${request.employeeName}'s ${request.leaveType} ${label}`;

  const shared = process.env.COMPANY_ADMIN_NOTIFICATION_EMAIL;
  if (shared) {
    await sendEmail({ to: shared, subject, html: templates.pendingApproval(request, 'Admin') });
  } else {
    console.warn('COMPANY_ADMIN_NOTIFICATION_EMAIL not set — admin-only request email skipped.');
  }

  const admins = await User.find({ role: 'admin', status: 'active' });
  for (const admin of admins) {
    // Never notify an admin about their own request (they cannot decide it).
    if (String(admin._id) === String(request.employeeId)) continue;
    await Notification.create({
      userId: admin._id,
      type,
      message,
      relatedLeaveRequestId: request._id,
      emailSent: Boolean(shared),
    });
  }
}

/** Notifies requiredApproverIds[0] — the gatekeeper of this request's own chain. */
export async function notifyGatekeeper(request, type = 'leave_pending_approval') {
  if (request.isAdminOnlyDecision) return notifyAdminsOfAdminOnlyRequest(request, type);
  const gatekeeperId = request.requiredApproverIds?.[0];
  if (!gatekeeperId) return;

  const gatekeeper = await User.findById(gatekeeperId);
  if (!gatekeeper) return;

  const label = labelFor(type);

  await notify({
    userId: gatekeeper._id,
    type,
    message: `${request.employeeName} submitted a ${request.leaveType} ${label} awaiting your approval.`,
    relatedLeaveRequestId: request._id,
    email: {
      to: gatekeeper.email,
      subject: `Action required: ${request.employeeName}'s ${request.leaveType} ${label}`,
      html: templates.pendingApproval(request, gatekeeper.fullName),
    },
  });
}

/**
 * Spec Part 8.2 — after any approve/reject/act-on-behalf, tell whoever the
 * chain now points at. If the chain is finished, tell the employee instead.
 */
export async function notifyNextStep(request, newStatus, comment) {
  const employee = await User.findById(request.employeeId);

  if (newStatus === 'approved') {
    if (employee) {
      await notify({
        userId: employee._id,
        type: 'leave_approved',
        message: `Your ${request.leaveType} leave request has been approved.`,
        relatedLeaveRequestId: request._id,
        email: {
          to: employee.email,
          subject: 'Your leave request was approved',
          html: templates.approved(request),
        },
      });
    }
    return;
  }

  if (newStatus === 'rejected') {
    if (employee) {
      await notify({
        userId: employee._id,
        type: 'leave_rejected',
        message: `Your ${request.leaveType} leave request was rejected.`,
        relatedLeaveRequestId: request._id,
        email: {
          to: employee.email,
          subject: 'Your leave request was rejected',
          html: templates.rejected(request, comment),
        },
      });
    }
    return;
  }

  // Still pending — notify whoever's turn it now is (the tier-2 approvers once
  // the gatekeeper has approved, or the remaining un-acted approvers).
  const turnIds = getCurrentTurnApproverIds(request);
  if (turnIds.length === 0) return;

  const approvers = await User.find({ _id: { $in: turnIds } });
  for (const approver of approvers) {
    await notify({
      userId: approver._id,
      type: 'leave_pending_approval',
      message: `${request.employeeName}'s ${request.leaveType} leave request is awaiting your approval.`,
      relatedLeaveRequestId: request._id,
      email: {
        to: approver.email,
        subject: `Action required: ${request.employeeName}'s ${request.leaveType} leave`,
        html: templates.pendingApproval(request, approver.fullName),
      },
    });
  }
}

export async function notifyCancelled(request) {
  const employee = await User.findById(request.employeeId);
  if (!employee) return;
  await notify({
    userId: employee._id,
    type: 'leave_cancelled',
    message: `Your ${request.leaveType} leave request was cancelled.`,
    relatedLeaveRequestId: request._id,
    email: {
      to: employee.email,
      subject: 'A leave request was cancelled',
      html: templates.cancelled(request),
    },
  });
}

/** Informational-only lifecycle mails to admins (Part 8.2 — no Notification type). */
export async function emailAdmins(subject, message) {
  const admins = await User.find({ role: 'admin', status: 'active' });
  for (const admin of admins) {
    await sendEmail({
      to: admin.email,
      subject,
      html: templates.employeeLifecycle(subject, message),
    });
  }
}
