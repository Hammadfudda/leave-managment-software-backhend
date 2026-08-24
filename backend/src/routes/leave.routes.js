import { Router } from 'express';

import * as leave from '../controllers/leave.controller.js';

import {
  listAvailablePolicies,
} from '../controllers/availablePolicies.controller.js';

import {
  authenticate,
  authorize,
  loadUser,
} from '../middleware/auth.js';

import {
  upload,
} from '../middleware/upload.js';

import {
  validateNewLeaveRequest,
} from '../middleware/validateNewLeaveRequest.js';

const router = Router();

router.use(
  authenticate,
  loadUser
);

router.get(
  '/available-types',
  leave.listAvailableLeaveTypes
);

router.get(
  '/available-policies',
  listAvailablePolicies
);

router.get(
  '/balance/:employeeId',
  leave.getBalance
);

router.get(
  '/',
  leave.listLeaveRequests
);

router.post(
  '/',
  authorize(
    'employee',
    'manager'
  ),
  upload.single(
    'attachment'
  ),
  validateNewLeaveRequest,
  leave.createLeaveRequest
);

router.get(
  '/:id/attachment-url',
  leave.getAttachmentUrl
);

router.get(
  '/:id',
  leave.getLeaveRequest
);

router.patch(
  '/:id/approve',
  authorize(
    'admin',
    'manager'
  ),
  leave.approve
);

router.patch(
  '/:id/reject',
  authorize(
    'admin',
    'manager'
  ),
  leave.reject
);

router.patch(
  '/:id/act-on-behalf',
  authorize(
    'admin'
  ),
  leave.actOnBehalfOf
);

router.post(
  '/:id/extend',
  authorize(
    'employee',
    'manager'
  ),
  leave.extendLeave
);

router.post(
  '/:id/request-stop',
  authorize(
    'employee',
    'manager'
  ),
  leave.requestStopLeave
);

export default router;
