import { Router } from 'express';

import * as leave from '../controllers/leave.controller.js';

import {
  authenticate,
  authorize,
  loadUser,
} from '../middleware/auth.js';

import {
  upload,
} from '../middleware/upload.js';

const router = Router();

/* =========================================================
   AUTH
========================================================= */

router.use(
  authenticate,
  loadUser
);

/* =========================================================
   LEAVE TYPES / BALANCE
========================================================= */

router.get(
  '/available-types',
  leave.listAvailableLeaveTypes
);

router.get(
  '/balance/:employeeId',
  leave.getBalance
);

/* =========================================================
   LEAVE REQUEST LIST
========================================================= */

router.get(
  '/',
  leave.listLeaveRequests
);

/* =========================================================
   CREATE LEAVE REQUEST
   Employee / Manager only

   multipart/form-data:
   - leaveType
   - startDate
   - endDate
   - reason
   - attachment (optional / required by policy)

   Attachment:
   PDF / JPG / JPEG / PNG
   Max 5 MB
========================================================= */

router.post(
  '/',
  authorize(
    'employee',
    'manager'
  ),
  upload.single(
    'attachment'
  ),
  leave.createLeaveRequest
);

/* =========================================================
   PRIVATE ATTACHMENT URL

   Backend authorization check ke baad
   temporary signed Cloudinary URL return hoga.

   Permanent public URL expose nahi hogi.
========================================================= */

router.get(
  '/:id/attachment-url',
  leave.getAttachmentUrl
);

/* =========================================================
   SINGLE LEAVE REQUEST
========================================================= */

router.get(
  '/:id',
  leave.getLeaveRequest
);

/* =========================================================
   APPROVE
========================================================= */

router.patch(
  '/:id/approve',
  authorize(
    'admin',
    'manager'
  ),
  leave.approve
);

/* =========================================================
   REJECT
========================================================= */

router.patch(
  '/:id/reject',
  authorize(
    'admin',
    'manager'
  ),
  leave.reject
);

/* =========================================================
   ADMIN ACT ON BEHALF
========================================================= */

router.patch(
  '/:id/act-on-behalf',
  authorize(
    'admin'
  ),
  leave.actOnBehalfOf
);

/* =========================================================
   EXTEND LEAVE
========================================================= */

router.post(
  '/:id/extend',
  authorize(
    'employee',
    'manager'
  ),
  leave.extendLeave
);

/* =========================================================
   STOP / EARLY RETURN REQUEST
========================================================= */

router.post(
  '/:id/request-stop',
  authorize(
    'employee',
    'manager'
  ),
  leave.requestStopLeave
);

export default router;