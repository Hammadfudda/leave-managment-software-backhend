const express = require('express');
const router = express.Router();
const leavePolicyController = require('../controllers/leavePolicy.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.get('/me', leavePolicyController.getMyLeavePolicy);

router.route('/')
  .get(restrictTo('Super Admin', 'Admin', 'HR Manager', 'Manager'), requirePermission('view_reports'), leavePolicyController.getLeavePolicies)
  .post(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_leave_policies'), leavePolicyController.createLeavePolicy);

router.route('/:id')
  .get(restrictTo('Super Admin', 'Admin', 'HR Manager', 'Manager'), requirePermission('view_reports'), leavePolicyController.getLeavePolicyById)
  .put(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_leave_policies'), leavePolicyController.updateLeavePolicy)
  .delete(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_leave_policies'), leavePolicyController.deleteLeavePolicy);

module.exports = router;
