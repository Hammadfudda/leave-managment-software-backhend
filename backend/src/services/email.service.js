import nodemailer from "nodemailer";

const smtpReady =
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.EMAIL_FROM;

/*
|--------------------------------------------------------------------------
| Public frontend URL
|--------------------------------------------------------------------------
| This URL is used ONLY inside emails.
| Do not use CLIENT_URL directly because CLIENT_URL may contain
| multiple comma-separated CORS origins.
|--------------------------------------------------------------------------
*/

const PORTAL_URL = (
  process.env.PUBLIC_APP_URL ||
  "https://leave-managment-software.vercel.app"
).replace(/\/+$/, "");

/*
|--------------------------------------------------------------------------
| Normalize URLs used in emails
|--------------------------------------------------------------------------
| If any old code passes a localhost URL (for example password reset),
| replace the localhost origin with the live Vercel frontend URL.
|--------------------------------------------------------------------------
*/

function normalizePortalUrl(url = "") {
  if (!url) {
    return PORTAL_URL;
  }

  try {
    const parsedUrl = new URL(url);

    const isLocalhost =
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "127.0.0.1";

    if (isLocalhost) {
      return `${PORTAL_URL}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    }

    return url;
  } catch {
    if (url.startsWith("/")) {
      return `${PORTAL_URL}${url}`;
    }

    return url;
  }
}

const transporter = smtpReady
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

/**
 * A failed email must NEVER roll back the action that triggered it.
 * Returns true on success and false on failure.
 */
export async function sendEmail({
  to,
  subject,
  html,
}) {
  try {
    if (!transporter) {
      console.warn(
        "SMTP configuration missing — skipping email:",
        subject,
        "->",
        to,
      );

      return false;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });

    return true;
  } catch (err) {
    console.error(
      "Email send failed:",
      err.message,
    );

    return false;
  }
}

export function layout(title, body) {
  return `
  <div
    style="
      font-family:system-ui,Segoe UI,Arial,sans-serif;
      max-width:560px;
      margin:0 auto;
      padding:24px;
    "
  >
    <h2 style="margin:0 0 16px">
      ${title}
    </h2>

    <div
      style="
        font-size:15px;
        line-height:1.6;
        color:#333;
      "
    >
      ${body}
    </div>

    <p
      style="
        margin-top:28px;
        font-size:12px;
        color:#888;
      "
    >
      Leave Management System — Nedd Consultant
    </p>
  </div>
  `;
}

export const templates = {
  /*
  |--------------------------------------------------------------------------
  | Account Created
  |--------------------------------------------------------------------------
  */

  accountCreated: (user) =>
    layout(
      "Your account is ready",
      `
        <p>Hi ${user.fullName},</p>

        <p>
          An account has been created for you on the
          Leave Management System.
        </p>

        <p>
          <strong>Email:</strong> ${user.email}<br/>
          <strong>Password:</strong> your CNIC (${user.cnic})
        </p>

        <p>
          <a href="${PORTAL_URL}">
            Open the portal
          </a>
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Client Admin Created
  |--------------------------------------------------------------------------
  */

  clientAdminCreated: ({
    adminName,
    companyName,
    email,
    password,
  }) =>
    layout(
      "Your Admin account is ready",
      `
        <p>Hi ${adminName},</p>

        <p>
          Your Leave Management Admin account for
          <strong>${companyName}</strong>
          has been created.
        </p>

        <p>
          <strong>Login URL:</strong>
          <a href="${PORTAL_URL}">
            ${PORTAL_URL}
          </a>
          <br/>

          <strong>Email:</strong>
          ${email}
          <br/>

          <strong>Password:</strong>
          ${password}
        </p>

        <p>
          You can now sign in and set up your Managers,
          Employees and leave settings.
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
          please mark it as
          <strong>Not Spam</strong>
          and add this sender to your contacts so future
          Leave Management notifications can reach your inbox.
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Pending Approval
  |--------------------------------------------------------------------------
  */

  pendingApproval: (
    request,
    recipientName,
  ) =>
    layout(
      "A leave request needs your approval",
      `
        <p>Hi ${recipientName},</p>

        <p>
          <strong>${request.employeeName}</strong>
          has submitted a
          <strong>${request.leaveType}</strong>
          leave request
          (
            ${new Date(
              request.startDate,
            ).toDateString()}
            –
            ${new Date(
              request.endDate,
            ).toDateString()},
            ${request.totalWorkingDays}
            working day(s)
          ).
        </p>

        <p>
          It is now your turn to act on it.
        </p>

        <p>
          <a href="${PORTAL_URL}/approvals">
            Review request
          </a>
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Approved
  |--------------------------------------------------------------------------
  */

  approved: (request) =>
    layout(
      "Your leave request was approved",
      `
        <p>
          Your
          <strong>${request.leaveType}</strong>
          leave from
          ${new Date(
            request.startDate,
          ).toDateString()}
          to
          ${new Date(
            request.endDate,
          ).toDateString()}
          has been fully approved.
        </p>

        <p>
          <a href="${PORTAL_URL}/leave/history">
            View leave history
          </a>
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Rejected
  |--------------------------------------------------------------------------
  */

  rejected: (request, comment) =>
    layout(
      "Your leave request was rejected",
      `
        <p>
          Your
          <strong>${request.leaveType}</strong>
          leave from
          ${new Date(
            request.startDate,
          ).toDateString()}
          to
          ${new Date(
            request.endDate,
          ).toDateString()}
          was rejected.
        </p>

        ${
          comment
            ? `
              <p>
                <strong>Comment:</strong>
                ${comment}
              </p>
            `
            : ""
        }

        <p>
          <a href="${PORTAL_URL}/leave/history">
            View leave history
          </a>
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Cancelled
  |--------------------------------------------------------------------------
  */

  cancelled: (request) =>
    layout(
      "A leave request was cancelled",
      `
        <p>
          The
          <strong>${request.leaveType}</strong>
          leave request for
          ${request.employeeName}
          has been cancelled.
        </p>

        <p>
          <a href="${PORTAL_URL}/leave/history">
            Open the portal
          </a>
        </p>
      `,
    ),

  /*
  |--------------------------------------------------------------------------
  | Password Reset
  |--------------------------------------------------------------------------
  */

  passwordReset: (user, url) => {
    const resetUrl =
      normalizePortalUrl(url);

    return layout(
      "Reset your password",
      `
        <p>Hi ${user.fullName},</p>

        <p>
          Use the link below to set a new password.
          It expires in 60 minutes.
        </p>

        <p>
          <a href="${resetUrl}">
            Reset password
          </a>
        </p>

        <p>
          If you didn't request this,
          you can safely ignore this email.
        </p>
      `,
    );
  },

  /*
  |--------------------------------------------------------------------------
  | Employee Lifecycle
  |--------------------------------------------------------------------------
  */

  employeeLifecycle: (
    title,
    message,
  ) =>
    layout(
      title,
      `
        <p>${message}</p>

        <p>
          <a href="${PORTAL_URL}">
            Open the portal
          </a>
        </p>
      `,
    ),
};