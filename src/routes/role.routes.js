const express = require('express');
const router = express.Router();
const roleController = require('../controllers/role.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.route('/')
  .get(roleController.getRoles)
  .post(restrictTo('Super Admin', 'Admin'), requirePermission('manage_roles'), roleController.createRole);

router.route('/:id')
  .get(roleController.getRoleById)
  .put(restrictTo('Super Admin', 'Admin'), requirePermission('manage_roles'), roleController.updateRole)
  .delete(restrictTo('Super Admin', 'Admin'), requirePermission('manage_roles'), roleController.deleteRole);

module.exports = router;
