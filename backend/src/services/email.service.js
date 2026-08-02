import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Spec Part 8.1 — a failed notification must NEVER roll back the action that
 * triggered it. This function never throws.
 */
export async function sendEmail({ to, subject, html }) {
  try {
    if (!resend) {
      console.warn('RESEND_API_KEY not set — skipping email:', subject, '->', to);
      return false;
    }
    await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL, to, subject, html });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

export function layout(title, body) {
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 16px">${title}</h2>
    <div style="font-size:15px;line-height:1.6;color:#333">${body}</div>
    <p style="margin-top:28px;font-size:12px;color:#888">Leave Management System — Nedd Consultant</p>
  </div>`;
}

export const templates = {
  accountCreated: (user) =>
    layout(
      'Your account is ready',
      `<p>Hi ${user.fullName},</p>
       <p>An account has been created for you on the Leave Management System.</p>
       <p><strong>Email:</strong> ${user.email}<br/>
          <strong>Temporary password:</strong> your CNIC (${user.cnic})</p>
       <p>Please sign in and change your password.</p>
       <p><a href="${process.env.CLIENT_URL}">Open the portal</a></p>`
    ),

  pendingApproval: (request, recipientName) =>
    layout(
      'A leave request needs your approval',
      `<p>Hi ${recipientName},</p>
       <p><strong>${request.employeeName}</strong> has submitted a
          <strong>${request.leaveType}</strong> leave request
          (${new Date(request.startDate).toDateString()} – ${new Date(request.endDate).toDateString()},
          ${request.totalWorkingDays} working day(s)).</p>
       <p>It is now your turn to act on it.</p>
       <p><a href="${process.env.CLIENT_URL}/approvals">Review request</a></p>`
    ),

  approved: (request) =>
    layout(
      'Your leave request was approved',
      `<p>Your <strong>${request.leaveType}</strong> leave from
          ${new Date(request.startDate).toDateString()} to
          ${new Date(request.endDate).toDateString()} has been fully approved.</p>`
    ),

  rejected: (request, comment) =>
    layout(
      'Your leave request was rejected',
      `<p>Your <strong>${request.leaveType}</strong> leave from
          ${new Date(request.startDate).toDateString()} to
          ${new Date(request.endDate).toDateString()} was rejected.</p>
       ${comment ? `<p><strong>Comment:</strong> ${comment}</p>` : ''}`
    ),

  cancelled: (request) =>
    layout(
      'A leave request was cancelled',
      `<p>The <strong>${request.leaveType}</strong> leave request for
          ${request.employeeName} has been cancelled.</p>`
    ),

  passwordReset: (user, url) =>
    layout(
      'Reset your password',
      `<p>Hi ${user.fullName},</p>
       <p>Use the link below to set a new password. It expires in 60 minutes.</p>
       <p><a href="${url}">Reset password</a></p>
       <p>If you didn't request this, you can safely ignore this email.</p>`
    ),

  employeeLifecycle: (title, message) => layout(title, `<p>${message}</p>`),
};
