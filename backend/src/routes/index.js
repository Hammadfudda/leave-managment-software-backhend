import { Router } from 'express';

import authRoutes from './auth.routes.js';
import employeeRoutes from './employee.routes.js';
import leaveRoutes from './leave.routes.js';
import policyRoutes from './policy.routes.js';
import teamRoutes from './team.routes.js';
import notificationRoutes from './notification.routes.js';
import dashboardRoutes from './dashboard.routes.js';

import {
  gradeRoutes,
  departmentRoutes,
  designationRoutes,
  roleRoutes,
} from './taxonomy.routes.js';

import {
  reportRoutes,
  calendarRoutes,
  auditRoutes,
} from './misc.routes.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
  });
});

router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/grades', gradeRoutes);
router.use('/departments', departmentRoutes);
router.use('/designations', designationRoutes);
router.use('/roles', roleRoutes);
router.use('/leave-policies', policyRoutes);
router.use('/leave-requests', leaveRoutes);
router.use('/team', teamRoutes);
router.use('/notifications', notificationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/calendar', calendarRoutes);
router.use('/audit-logs', auditRoutes);

export default router;