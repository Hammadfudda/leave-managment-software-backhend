import crypto from 'crypto';

import {
  layout,
  sendEmail,
} from './email.service.js';

const PORTAL_URL = (
  process.env.PUBLIC_APP_URL ||
  'https://leave-managment-software.vercel.app'
).replace(/\/+$/, '');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function generateTemporaryPassword() {
  // 16 chars total with guaranteed upper/lower/number/symbol content.
  const random = crypto
    .randomBytes(9)
    .toString('base64url')
    .slice(0, 12);

  return `T!7a${random}`;
}

export async function sendTemporaryAccountEmail({
  to,
  fullName,
  roleLabel,
  temporaryPassword,
  companyName,
}) {
  const safeName = escapeHtml(fullName);
  const safeRole = escapeHtml(roleLabel);
  const safeCompany = escapeHtml(companyName || '');
  const safeEmail = escapeHtml(to);
  const safePassword = escapeHtml(temporaryPassword);

  return sendEmail({
    to,
    subject: 'Your Leave Management account is ready',
    html: layout(
      'Your account is ready',
      `
        <p>Hi ${safeName},</p>

        <p>
          Your ${safeRole} account${
            companyName
              ? ` for <strong>${safeCompany}</strong>`
              : ''
          } has been created on the Leave Management System.
        </p>

        <p>
          <strong>Login URL:</strong>
          <a href="${PORTAL_URL}">${PORTAL_URL}</a>
          <br/>
          <strong>Email:</strong> ${safeEmail}
          <br/>
          <strong>Temporary Password:</strong> ${safePassword}
        </p>

        <p style="font-weight:600;color:#b45309;">
          Once you log in, you have to change your password.
        </p>

        <p>
          After you change it, your new password is private to you.
        </p>

        <p
          style="
            margin-top:20px;
            padding:12px 14px;
            background:#f8fafc;
            border:1px solid #e2e8f0;
            border-radius:8px;
            color:#475569;
            font-size:13px;
          "
        >
          If this email appears in your Spam or Junk folder,
          please click or tap <strong>Not Spam</strong>
          (or <strong>Mark as not spam</strong>) and add this sender
          to your contacts.
        </p>
      `
    ),
  });
}
