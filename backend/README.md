# Leave Management System — Backend

Node.js + Express + MongoDB implementation of **Backend Implementation Spec v2**
and the companion `API_ENDPOINTS` list. Drop this `backend/` folder into your own
repo (or push it standalone) — it has no dependency on the surrounding project.

## Quick start

```bash
cd backend
npm install
cp .env.example .env      # fill in the values below
npm run seed              # optional: creates an admin/manager/employee to log in with
npm run dev               # http://localhost:5000/api
```

## Environment variables

Everything below goes in `backend/.env`. Nothing is hardcoded anywhere in the code.

| Variable | Where to get it | Required |
| --- | --- | --- |
| `MONGODB_URI` | MongoDB Atlas → Cluster → Connect → Drivers. Looks like `mongodb+srv://user:pass@cluster.xxxx.mongodb.net/leave-management` | yes |
| `JWT_ACCESS_SECRET` | Any long random string — `openssl rand -hex 32` | yes |
| `JWT_REFRESH_SECRET` | A **different** long random string | yes |
| `RESEND_API_KEY` | resend.com → API Keys → Create (`re_...`) | for emails |
| `RESEND_FROM_EMAIL` | A sender on a domain you verified in Resend, e.g. `Leave System <no-reply@yourdomain.com>` | for emails |
| `CLOUDINARY_CLOUD_NAME` | cloudinary.com → Dashboard → Product environment credentials | for attachments |
| `CLOUDINARY_API_KEY` | same dashboard | for attachments |
| `CLOUDINARY_API_SECRET` | same dashboard (click "reveal") | for attachments |
| `CLIENT_URL` | Your frontend origin, e.g. `http://localhost:5173`. Comma-separate several. | yes |
| `PORT` / `NODE_ENV` | default `5000` / `development` | no |

If `RESEND_API_KEY` is missing the app still runs — emails are logged and skipped
instead of sent, and a failed email never rolls back the action that triggered it.

## Seeded logins

`npm run seed` creates (password = the person's CNIC, per spec Part 3.1):

| Role | Email | Password |
| --- | --- | --- |
| admin | admin@example.com | `11111-1111111-1` |
| manager | manager@example.com | `22222-2222222-2` |
| employee | employee@example.com | `33333-3333333-3` |

## Layout

```
src/
  app.js               express app (helmet, cors+credentials, cookies, rate limit)
  server.js            entry point — validates env, connects Mongo, starts crons
  seed.js              idempotent starter data
  config/              db.js, cloudinary.js
  models/              11 Mongoose models (spec Part 2)
  middleware/          authenticate/authorize/loadUser, error handler, uploads, rate limits
  services/            approvalChain, approval, balance, eligibility, notification, email
  controllers/         auth, employee, taxonomy, policy, leave, team, notification, report, calendar, audit
  routes/              one router per resource, mounted under /api by routes/index.js
  jobs/                nightly 02:00 purge of expired pending_deletion employees
  utils/               errors, asyncHandler, dates, tokens, pagination, audit
```

## Behaviour worth knowing

- **Approval chain (Part 5).** `requiredApproverIds[0]` is the gatekeeper —
  nobody downstream can act until they do, and their rejection is final. Indexes
  1+ form a parallel tier that unlocks only after the gatekeeper approves; all of
  them must approve. Turn order is enforced server-side, not just in the UI.
- **Nobody approves their own leave**, Admin included. Admin's override
  (`act-on-behalf`) fills exactly one named approver's slot; the chain then
  continues normally.
- **Extensions and stop-requests are new documents**, never mutations of the
  original, and each runs the full chain again. Balance only moves on approval.
- **Weekend exclusion is per-department.** Sunday is always off; Saturday is off
  unless the department has `saturdayOff: false` (6-day week).
- **Policy scope vs routing are independent.** `approvalRouting.department/grade/
  designation` says who the policy *applies to*; `approverIds` says who *approves*.
- **Soft delete.** Removing an employee sets `pending_deletion` + a 7-day
  `scheduledPurgeAt`, revokes their refresh token immediately, and the nightly
  cron purges them afterwards. Their leave requests survive the purge because
  other people acted on them.
- **Uploads go browser → API → Cloudinary**, never browser → Cloudinary, so
  type/size limits cannot be bypassed client-side.
- **Audit log is append-only** — no edit or delete endpoint exists anywhere.
- **404 over 403** for records the caller has no business seeing, so the API
  never confirms a record exists to an outsider.

## Endpoints

All under `/api`. Access token in `Authorization: Bearer <token>`; the refresh
token is an httpOnly cookie set by `/auth/login`.

```
POST   /auth/login | /auth/logout | /auth/refresh | /auth/forgot-password | /auth/reset-password

GET    /employees                 POST   /employees              GET  /employees/me
GET    /employees/:id             PATCH  /employees/:id          GET  /employees/removed
PATCH  /employees/:id/remove      PATCH  /employees/:id/restore
GET    /employees/export.csv      POST   /employees/import

GET/POST/PATCH/DELETE  /grades | /departments | /designations | /roles

GET    /leave-policies            POST  /leave-policies          PATCH /leave-policies/:id
GET    /leave-policies/eligible-approvers?department=X

GET    /leave-requests            POST  /leave-requests (multipart: attachment)
GET    /leave-requests/available-types
GET    /leave-requests/:id
PATCH  /leave-requests/:id/approve | /reject | /act-on-behalf
POST   /leave-requests/:id/extend | /request-stop
GET    /leave-requests/balance/:employeeId

GET    /team/my-team              GET   /team/managers?department=X
GET    /notifications             PATCH /notifications/:id/read
GET    /reports/summary           GET   /reports/export.csv
GET    /calendar                  GET   /audit-logs (admin)
GET    /health
```

Every list endpoint takes `?page=1&limit=20` plus the filters in the endpoint
list. Role scoping is always applied **before** query filters.

## Responses

```jsonc
{ "success": true,  "data": {...}, "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 1 } }
{ "success": false, "message": "Human readable", "errors": { "field": "why" } }
```

Statuses: 400 validation · 401 unauthenticated · 403 not your turn / not allowed ·
404 not found or not yours · 409 duplicate/in-use · 423 account locked · 500 generic.
