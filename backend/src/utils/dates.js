/**
 * Spec Part 6.3 — Weekend exclusion (department-configurable).
 * Sunday is always off. Saturday is off only when the department has
 * saturdayOff === true (a 6-day-week department works Saturdays).
 */

export function calcWorkingDays(start, end, saturdayOff = true) {
  let count = 0;
  const cur = new Date(start);
  const e = new Date(end);
  while (cur <= e) {
    const dow = cur.getDay();
    if (!(dow === 0) && !(dow === 6 && saturdayOff)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function getExcludedWeekendDates(start, end, saturdayOff = true) {
  const excluded = [];
  const cur = new Date(start);
  const e = new Date(end);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow === 0 || (dow === 6 && saturdayOff)) {
      excluded.push(cur.toISOString().split('T')[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return excluded;
}

export function calcCalendarDays(start, end) {
  const ms = new Date(end).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000) + 1;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toISODate(date) {
  return new Date(date).toISOString().split('T')[0];
}
