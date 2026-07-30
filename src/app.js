require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const employeeRoutes = require('./routes/employee.routes');
const gradeRoutes = require('./routes/grade.routes');
const departmentRoutes = require('./routes/department.routes');
const designationRoutes = require('./routes/designation.routes');
const roleRoutes = require('./routes/role.routes');
const leavePolicyRoutes = require('./routes/leavePolicy.routes');
const leaveRequestRoutes = require('./routes/leaveRequest.routes');
const teamRoutes = require('./routes/team.routes');
const notificationRoutes = require('./routes/notification.routes');
const reportRoutes = require('./routes/report.routes');
const calendarRoutes = require('./routes/calendar.routes');
const auditLogRoutes = require('./routes/auditLog.routes');

connectDB();

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/designations', designationRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/leave-policies', leavePolicyRoutes);
app.use('/api/leave-requests', leaveRequestRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.use(errorHandler);

module.exports = app;
