# Leave Management System - Backend API

A complete Node.js + Express + MongoDB backend for a leave management system with multi-stage approval workflows, role-based access control, leave balance tracking, and reporting.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Auth**: JWT (access + refresh tokens)
- **File Uploads**: Cloudinary (attachments) + memory (CSV)
- **Email**: Resend
- **Security**: Helmet, CORS, express-rate-limit, bcryptjs
- **Scheduled Jobs**: node-cron

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Install dependencies:
   ```bash
   npm install
   ```
3. Seed the database (creates default roles, super admin, grade, leave policy, department):
   ```bash
   npm run seed
   ```
4. Start the server:
   ```bash
   npm run dev   # development
   npm start     # production
   ```

## Default Super Admin

- **Email**: admin@company.com
- **Password**: admin123
- Change this immediately after first login.

## API Endpoints

### Authentication (`/api/auth`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| POST | /login | Login with email/password | Public |
| POST | /register | Register new user | Public |
| POST | /logout | Logout | Authenticated |
| POST | /refresh-token | Refresh access token | Public |
| GET | /me | Get current user profile | Authenticated |
| PUT | /change-password | Change password | Authenticated |
| POST | /forgot-password | Request password reset | Public (rate-limited) |

### Employees (`/api/employees`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | /me | Get own profile | Authenticated |
| GET | /team | Get own team | Authenticated |
| GET | / | List all employees | HR+ |
| POST | / | Create employee | HR+ |
| POST | /import-csv | Bulk import via CSV | HR+ |
| GET | /:id | Get employee by ID | Owner/Manager/HR+ |
| PUT | /:id | Update employee | HR+ |
| DELETE | /:id | Deactivate employee | HR+ |

### Grades (`/api/grades`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List grades | Authenticated |
| POST | / | Create grade | HR+ |
| GET | /:id | Get grade | Authenticated |
| PUT | /:id | Update grade | HR+ |
| DELETE | /:id | Delete grade | HR+ |

### Departments (`/api/departments`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List departments | Authenticated |
| POST | / | Create department | HR+ |
| GET | /:id | Get department | Authenticated |
| PUT | /:id | Update department | HR+ |
| DELETE | /:id | Delete department | HR+ |

### Designations (`/api/designations`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List designations | Authenticated |
| POST | / | Create designation | HR+ |
| GET | /:id | Get designation | Authenticated |
| PUT | /:id | Update designation | HR+ |
| DELETE | /:id | Delete designation | HR+ |

### Roles (`/api/roles`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List roles | Authenticated |
| POST | / | Create role | Admin+ |
| GET | /:id | Get role | Authenticated |
| PUT | /:id | Update role | Admin+ |
| DELETE | /:id | Delete role | Admin+ |

### Leave Policies (`/api/leave-policies`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | /me | Get own leave policy | Authenticated |
| GET | / | List policies | Manager+ |
| POST | / | Create policy | HR+ |
| GET | /:id | Get policy | Manager+ |
| PUT | /:id | Update policy | HR+ |
| DELETE | /:id | Delete policy | HR+ |

### Leave Requests (`/api/leave-requests`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | /me | Get own requests | Authenticated |
| GET | /me/balance | Get own leave balance | Authenticated |
| POST | / | Create leave request | Authenticated |
| POST | /:id/withdraw | Withdraw own pending request | Owner |
| GET | /pending-approvals | Get requests pending my approval | Approver |
| POST | /:id/approve | Approve (current stage) | Approver |
| POST | /:id/reject | Reject | Approver |
| POST | /:id/cancel | Cancel (owner or HR) | Owner/HR+ |
| GET | / | List requests (role-filtered) | Authenticated |
| GET | /:id | Get request detail | Owner/Approver/HR+ |

### Team (`/api/team`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | Get my team | Team Lead+ |
| GET | /on-leave-today | Team members on leave today | Team Lead+ |
| GET | /calendar | Team leave calendar (by month) | Team Lead+ |
| GET | /stats | Team leave statistics | Team Lead+ |

### Notifications (`/api/notifications`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List notifications | Authenticated |
| GET | /unread-count | Unread count | Authenticated |
| PUT | /:id/read | Mark as read | Authenticated |
| PUT | /read-all | Mark all as read | Authenticated |
| DELETE | /:id | Delete notification | Authenticated |

### Reports (`/api/reports`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | /dashboard | Dashboard stats | Authenticated |
| GET | /leave-summary | Leave summary report | Manager+ |
| GET | /department | Department-wise report | Manager+ |
| GET | /export-csv | Export CSV | Manager+ |

### Calendar (`/api/calendar`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | Monthly calendar (holidays + leaves) | Authenticated |
| GET | /holidays | List holidays | Authenticated |
| POST | /holidays | Create holiday | HR+ |
| GET | /holidays/:id | Get holiday | Authenticated |
| PUT | /holidays/:id | Update holiday | HR+ |
| DELETE | /holidays/:id | Delete holiday | HR+ |

### Audit Logs (`/api/audit-logs`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | / | List audit logs | Admin+ |
| GET | /:id | Get audit log | Admin+ |
| GET | /export-csv | Export CSV | Admin+ |

## Role Hierarchy

1. **Super Admin** (100) - Full access including roles & audit logs
2. **Admin** (90) - Full access except audit logs
3. **HR Manager** (70) - Manage employees, policies, departments, approve/reject
4. **Manager** (50) - View team, approve/reject team leaves, reports
5. **Team Lead** (30) - View team, approve/reject team leaves
6. **Employee** (10) - Request leave, view own records

## Leave Approval Workflow

1. Employee submits a leave request
2. System builds approval chain: Team Lead → Manager (skips null stages)
3. First approver receives notification (in-app + email)
4. Approver approves → forwards to next stage, or rejects
5. Final approval → status becomes "approved", balance updated
6. Rejection at any stage → status becomes "rejected", pending balance released
7. Employee can withdraw pending requests or cancel approved ones

## Leave Balance Calculation

- **Total**: default days (from policy) + carry-forwarded days
- **Used**: sum of approved leave days in current leave year
- **Pending**: sum of pending leave days in current leave year
- **Available**: total - used - pending

Leave days exclude weekends and public holidays. Half-day sessions count as 0.5 days.

## Scheduled Jobs

- **Employee Purge**: Runs daily at 2 AM (configurable via `PURGE_CRON_EXPRESSION`). Permanently deletes employees who have been inactive for more than `PURGE_AFTER_DAYS` (default 90).

## Environment Variables

See `.env.example` for all required configuration.
"# leave-managment-software-backhend" 
"# leave-managment-software-backhend" 
"# leave-managment-software-backhend" 
