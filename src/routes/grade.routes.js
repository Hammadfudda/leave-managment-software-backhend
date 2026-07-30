const express = require('express');
const router = express.Router();
const gradeController = require('../controllers/grade.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.route('/')
  .get(gradeController.getGrades)
  .post(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_grades'), gradeController.createGrade);

router.route('/:id')
  .get(gradeController.getGradeById)
  .put(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_grades'), gradeController.updateGrade)
  .delete(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_grades'), gradeController.deleteGrade);

module.exports = router;
