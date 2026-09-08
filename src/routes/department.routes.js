const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/department.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.route('/')
  .get(departmentController.getDepartments)
  .post(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_departments'), departmentController.createDepartment);

router.route('/:id')
  .get(departmentController.getDepartmentById)
  .put(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_departments'), departmentController.updateDepartment)
  .delete(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_departments'), departmentController.deleteDepartment);

module.exports = router;
