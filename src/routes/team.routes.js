const express = require('express');
const router = express.Router();
const teamController = require('../controllers/team.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/rbac');

router.use(protect);
router.use(restrictTo('Team Lead', 'Manager', 'HR Manager', 'Admin', 'Super Admin'));

router.get('/', teamController.getMyTeam);
router.get('/on-leave-today', teamController.getTeamOnLeaveToday);
router.get('/calendar', teamController.getTeamLeaveCalendar);
router.get('/stats', teamController.getTeamLeaveStats);

module.exports = router;
