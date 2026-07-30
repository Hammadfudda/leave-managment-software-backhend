const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employee.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');
const { uploadCSV } = require('../config/cloudinary');

router.use(protect);

router.get('/me', employeeController.getMyProfile);
router.get('/team', employeeController.getMyTeam);

router.use(restrictTo('Super Admin', 'Admin', 'HR Manager'));

router.route('/')
  .get(requirePermission('view_all_employees'), employeeController.getEmployees)
  .post(requirePermission('manage_employees'), employeeController.createEmployee);

router.post('/import-csv', requirePermission('manage_employees'), uploadCSV.single('file'), employeeController.importCSV);

router.route('/:id')
  .get(employeeController.getEmployeeById)
  .put(requirePermission('manage_employees'), employeeController.updateEmployee)
  .delete(requirePermission('manage_employees'), employeeController.deleteEmployee);

module.exports = router;
