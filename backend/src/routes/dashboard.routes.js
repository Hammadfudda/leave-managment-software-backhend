import { Router } from 'express';
import * as dashboard from '../controllers/dashboard.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, loadUser);

// ADDENDUM 2.3 — each role gets its own endpoint. Admin's is company-wide
// aggregates only; there is deliberately no personal-leave data on it.
router.get('/admin', authorize('admin'), dashboard.adminDashboard);
router.get('/manager', authorize('admin', 'manager'), dashboard.managerDashboard);
router.get('/employee', dashboard.employeeDashboard);

export default router;
