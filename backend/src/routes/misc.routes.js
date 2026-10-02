import { Router } from 'express';
import * as reports from '../controllers/report.controller.js';
import { calendar } from '../controllers/calendar.controller.js';
import { listAuditLogs, yearlyLeaveReport, exportYearlyLeaveReport } from '../controllers/audit.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';
import Organization from '../models/Organization.js';
import { ValidationError } from '../utils/errors.js';

export const reportRoutes = Router();
reportRoutes.use(authenticate, loadUser);
reportRoutes.get('/summary', reports.summary);
reportRoutes.get('/export.csv', reports.exportRequestsCsv);

export const calendarRoutes = Router();
calendarRoutes.use(authenticate, loadUser);
calendarRoutes.get('/', calendar);

export const auditRoutes = Router();
auditRoutes.use(authenticate, loadUser, authorize('admin'));
auditRoutes.get('/', listAuditLogs);
auditRoutes.get('/yearly', yearlyLeaveReport);
auditRoutes.get('/yearly/export.csv', exportYearlyLeaveReport);

// Organization leave-year settings. Defaults are Jan 1 when no setting has been changed.
export const organizationSettingsRoutes = Router();
organizationSettingsRoutes.use(authenticate, loadUser);
organizationSettingsRoutes.get('/', authorize('admin'), async (req, res) => {
  const organization = await Organization.findOne({ adminUserId: req.currentUser._id });
  const month = organization?.leaveYearStartMonth || 1;
  const day = organization?.leaveYearStartDay || 1;
  res.json({ success: true, data: { leaveYearStartDay: day, leaveYearStartMonth: month, leaveYearStart: String(day).padStart(2,'0') + '-' + String(month).padStart(2,'0') } });
});
organizationSettingsRoutes.patch('/', authorize('admin'), async (req, res) => {
  const month = Number(req.body.leaveYearStartMonth);
  const day = Number(req.body.leaveYearStartDay);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) throw new ValidationError('A valid leave year start date is required.');
  const organization = await Organization.findOne({ adminUserId: req.currentUser._id });
  if (!organization) throw new ValidationError('Organization was not found for this admin.');
  organization.leaveYearStartMonth = month;
  organization.leaveYearStartDay = day;
  await organization.save();
  res.json({ success: true, data: { leaveYearStartDay: day, leaveYearStartMonth: month, leaveYearStart: String(day).padStart(2,'0') + '-' + String(month).padStart(2,'0') } });
});
