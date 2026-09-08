const express = require('express');
const router = express.Router();
const leaveRequestController = require('../controllers/leaveRequest.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');
const { uploadAttachment } = require('../config/cloudinary');

router.use(protect);

// Employee endpoints
router.get('/me', leaveRequestController.getMyLeaveRequests);
router.get('/me/balance', leaveRequestController.getMyLeaveBalance);
router.post('/', leaveRequestController.createLeaveRequest);
router.post('/:id/withdraw', leaveRequestController.withdrawLeaveRequest);

// Approver endpoints
router.get('/pending-approvals', leaveRequestController.getPendingApprovals);
router.post('/:id/approve', requirePermission('approve_leave'), leaveRequestController.approveLeaveRequest);
router.post('/:id/reject', requirePermission('approve_leave'), leaveRequestController.rejectLeaveRequest);

// Cancel (owner or HR)
router.post('/:id/cancel', leaveRequestController.cancelLeaveRequest);

// Listing & detail (role-filtered in controller)
router.get('/', leaveRequestController.getLeaveRequests);
router.get('/:id', leaveRequestController.getLeaveRequestById);

module.exports = router;
