import { Router } from 'express';
import * as reports from '../controllers/report.controller.js';
import { calendar } from '../controllers/calendar.controller.js';
import { listAuditLogs } from '../controllers/audit.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';

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
