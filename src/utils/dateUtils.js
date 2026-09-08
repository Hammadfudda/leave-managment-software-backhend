/**
 * Calculate the number of leave days between two dates.
 * Excludes weekends and public holidays.
 * Supports half-day sessions.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {Object} options
 * @param {String} options.startSession - 'full_day' | 'first_half' | 'second_half'
 * @param {String} options.endSession - 'full_day' | 'first_half' | 'second_half'
 * @param {String} options.weekendPolicy - 'saturday_sunday' | 'sunday_only' | 'friday_saturday'
 * @param {Array<Date>} holidays - array of holiday dates
 * @returns {number} total leave days (can be fractional for half-days)
 */
function calculateLeaveDays(startDate, endDate, options = {}, holidays = []) {
  const {
    startSession = 'full_day',
    endSession = 'full_day',
    weekendPolicy = 'saturday_sunday',
  } = options;

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (start > end) return 0;

  const holidaySet = new Set(
    holidays.map((h) => {
      const d = new Date(h);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })
  );

  const isWeekend = (date) => {
    const day = date.getDay();
    switch (weekendPolicy) {
      case 'sunday_only':
        return day === 0;
      case 'friday_saturday':
        return day === 5 || day === 6;
      case 'saturday_sunday':
      default:
        return day === 0 || day === 6;
    }
  };

  const isHoliday = (date) => holidaySet.has(date.getTime());

  if (start.getTime() === end.getTime()) {
    if (isWeekend(start) || isHoliday(start)) return 0;
    if (startSession === 'full_day') return 1;
    return 0.5;
  }

  let totalDays = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    if (!isWeekend(cursor) && !isHoliday(cursor)) {
      if (cursor.getTime() === start.getTime() && startSession !== 'full_day') {
        totalDays += 0.5;
      } else if (cursor.getTime() === end.getTime() && endSession !== 'full_day') {
        totalDays += 0.0;
      } else {
        totalDays += 1;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (endSession !== 'full_day' && end.getTime() !== start.getTime()) {
    totalDays -= 0.5;
  }

  return Math.max(totalDays, 0);
}

function getLeaveYearStart(date = new Date()) {
  const month = parseInt(process.env.COMPANY_LEAVE_YEAR_START_MONTH || '1', 10);
  const day = parseInt(process.env.COMPANY_LEAVE_YEAR_START_DAY || '1', 10);
  const year = date.getFullYear();
  const start = new Date(year, month - 1, day);
  if (start > date) {
    return new Date(year - 1, month - 1, day);
  }
  return start;
}

function getLeaveYearEnd(date = new Date()) {
  const start = getLeaveYearStart(date);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return end;
}

function formatDate(date) {
  if (!date) return '';
  return new Date(date).toISOString().split('T')[0];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffInDays(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

module.exports = {
  calculateLeaveDays,
  getLeaveYearStart,
  getLeaveYearEnd,
  formatDate,
  addDays,
  diffInDays,
};
