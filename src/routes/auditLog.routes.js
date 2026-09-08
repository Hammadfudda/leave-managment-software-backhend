const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLog.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);
router.use(restrictTo('Super Admin', 'Admin'));
router.use(requirePermission('view_audit_logs'));

router.get('/', auditLogController.getAuditLogs);
router.get('/export-csv', auditLogController.exportAuditLogsCSV);
router.get('/:id', auditLogController.getAuditLogById);

module.exports = router;
