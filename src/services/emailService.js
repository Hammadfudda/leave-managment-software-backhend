const { Resend } = require('resend');

let resend = null;
function getClient() {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY || '');
  }
  return resend;
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email mock] to=${to} subject=${subject}`);
    return { id: 'mock' };
  }
  try {
    const client = getClient();
    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM || 'Leave Management <noreply@yourdomain.com>',
      to,
      subject,
      html,
      text: text || subject,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Email send failed:', err.message);
    throw err;
  }
}

async function sendWelcomeEmail(to, name, tempPassword) {
  return sendEmail({
    to,
    subject: `Welcome to ${process.env.COMPANY_NAME || 'the company'} - Your account is ready`,
    html: `
      <h2>Welcome, ${name}!</h2>
      <p>Your account has been created. Please log in with the temporary password below and change it immediately:</p>
      <p><strong>Temporary password:</strong> ${tempPassword}</p>
      <p>Login at: ${process.env.CLIENT_URL || ''}</p>
    `,
  });
}

async function sendLeaveSubmittedEmail(to, employeeName, leaveDetails) {
  return sendEmail({
    to,
    subject: `New leave request from ${employeeName}`,
    html: `
      <h2>New Leave Request</h2>
      <p><strong>Employee:</strong> ${employeeName}</p>
      <p><strong>Type:</strong> ${leaveDetails.leaveType}</p>
      <p><strong>From:</strong> ${leaveDetails.startDate} <strong>To:</strong> ${leaveDetails.endDate}</p>
      <p><strong>Days:</strong> ${leaveDetails.totalDays}</p>
      <p><strong>Reason:</strong> ${leaveDetails.reason}</p>
      <p>Please review and take action in the portal.</p>
    `,
  });
}

async function sendLeaveStatusEmail(to, employeeName, status, leaveDetails, comment = '') {
  return sendEmail({
    to,
    subject: `Your leave request has been ${status}`,
    html: `
      <h2>Leave ${status}</h2>
      <p>Hi ${employeeName},</p>
      <p>Your leave request (${leaveDetails.leaveType}, ${leaveDetails.startDate} to ${leaveDetails.endDate}) has been <strong>${status}</strong>.</p>
      ${comment ? `<p><strong>Comment:</strong> ${comment}</p>` : ''}
    `,
  });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLeaveSubmittedEmail,
  sendLeaveStatusEmail,
};
