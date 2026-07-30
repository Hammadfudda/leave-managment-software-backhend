const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendar.controller');
const { protect } = require('../middleware/auth');
const { restrictTo, requirePermission } = require('../middleware/rbac');

router.use(protect);

router.get('/', calendarController.getCalendar);

router.route('/holidays')
  .get(calendarController.getHolidays)
  .post(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_calendar'), calendarController.createHoliday);

router.route('/holidays/:id')
  .get(calendarController.getHolidayById)
  .put(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_calendar'), calendarController.updateHoliday)
  .delete(restrictTo('Super Admin', 'Admin', 'HR Manager'), requirePermission('manage_calendar'), calendarController.deleteHoliday);

module.exports = router;
