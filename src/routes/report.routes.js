const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.get('/dashboard', reportController.getDashboardStats);

router.use(restrictTo('HR Manager', 'Admin', 'Super Admin', 'Manager'));
router.use(requirePermission('view_reports'));

router.get('/leave-summary', reportController.getLeaveSummaryReport);
router.get('/department', reportController.getDepartmentReport);
router.get('/export-csv', reportController.exportReportCSV);

module.exports = router;
