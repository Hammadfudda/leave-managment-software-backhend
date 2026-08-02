import { Router } from 'express';
import * as leave from '../controllers/leave.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(authenticate, loadUser);

router.get('/available-types', leave.listAvailableLeaveTypes);
router.get('/balance/:employeeId', leave.getBalance);

router.get('/', leave.listLeaveRequests);
// Employees and managers submit their OWN leave. Admin never submits leave for
// anyone, so admin is deliberately excluded from this one route (Part 5.1).
router.post('/', authorize('employee', 'manager'), upload.single('attachment'), leave.createLeaveRequest);

router.get('/:id', leave.getLeaveRequest);
router.patch('/:id/approve', authorize('admin', 'manager'), leave.approve);
router.patch('/:id/reject', authorize('admin', 'manager'), leave.reject);
router.patch('/:id/act-on-behalf', authorize('admin'), leave.actOnBehalfOf);
router.post('/:id/extend', authorize('employee', 'manager'), leave.extendLeave);
router.post('/:id/request-stop', authorize('employee', 'manager'), leave.requestStopLeave);

export default router;
