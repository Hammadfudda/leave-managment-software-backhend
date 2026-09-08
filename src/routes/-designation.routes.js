const express = require('express');
const router = express.Router();
const designationController = require('../controllers/designation.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.route('/')
  .get(designationController.getDesignations)
  .post(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_designations'), designationController.createDesignation);

router.route('/:id')
  .get(designationController.getDesignationById)
  .put(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_designations'), designationController.updateDesignation)
  .delete(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_designations'), designationController.deleteDesignation);

module.exports = router;
