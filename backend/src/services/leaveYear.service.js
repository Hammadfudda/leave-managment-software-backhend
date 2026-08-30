import Organization from '../models/Organization.js';
import LegacyOrganizationSettings from '../models/LegacyOrganizationSettings.js';
import { ValidationError } from '../utils/errors.js';

function isValidDayMonth(day, month) {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const probe = new Date(Date.UTC(2024, month - 1, day));

  return (
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function normalizeLeaveYearStart({ day, month }) {
  const normalizedDay = Number(day);
  const normalizedMonth = Number(month);

  if (!isValidDayMonth(normalizedDay, normalizedMonth)) {
    throw new ValidationError('Leave Year Start contains an invalid day/month.');
  }

  return {
    day: normalizedDay,
    month: normalizedMonth,
  };
}

export function formatLeaveYearStart(config) {
  const normalized = normalizeLeaveYearStart(config);

  return `${String(normalized.day).padStart(2, '0')}-${String(
    normalized.month
  ).padStart(2, '0')}`;
}

export function parseLeaveYearStart(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  const numeric = text.match(/^(\d{1,2})[-/](\d{1,2})$/);

  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);

    return isValidDayMonth(day, month)
      ? { day, month }
      : null;
  }

  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  const dayMonth = text.toLowerCase().match(/^(\d{1,2})\s+([a-z]+)$/);

  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = months.indexOf(dayMonth[2]) + 1;

    return isValidDayMonth(day, month)
      ? { day, month }
      : null;
  }

  const monthDay = text.toLowerCase().match(/^([a-z]+)\s+(\d{1,2})$/);

  if (monthDay) {
    const month = months.indexOf(monthDay[1]) + 1;
    const day = Number(monthDay[2]);

    return isValidDayMonth(day, month)
      ? { day, month }
      : null;
  }

  return null;
}

export function getLegacyLeaveYearScopeKey(organizationId) {
  return organizationId
    ? `missing-organization:${String(organizationId)}`
    : 'legacy-unscoped';
}

export async function getOrganizationLeaveYearConfig(organizationId, options = {}) {
  let organization = null;

  if (organizationId) {
    let query = Organization.findById(organizationId).select(
      'leaveYearStartDay leaveYearStartMonth'
    );

    if (options.session) {
      query = query.session(options.session);
    }

    organization = await query.lean();
  }

  if (organization) {
    return normalizeLeaveYearStart({
      day: organization.leaveYearStartDay ?? 1,
      month: organization.leaveYearStartMonth ?? 1,
    });
  }

  /*
   * Legacy/backward-compatible fallback.
   * Old System Administrator data can have organizationId=null (or an old
   * dangling Organization id). Persist a Leave Year setting without changing
   * the user's tenant id, so existing unscoped Division/Department data does
   * not disappear or get moved into a new tenant unexpectedly.
   */
  let legacyQuery = LegacyOrganizationSettings.findOne({
    scopeKey: getLegacyLeaveYearScopeKey(organizationId),
  });

  if (options.session) {
    legacyQuery = legacyQuery.session(options.session);
  }

  const legacy = await legacyQuery.lean();

  return normalizeLeaveYearStart({
    day: legacy?.leaveYearStartDay ?? 1,
    month: legacy?.leaveYearStartMonth ?? 1,
  });
}

export function getLeaveYearBounds(leaveYear, config) {
  const normalized = normalizeLeaveYearStart(config);

  const start = new Date(
    Date.UTC(
      Number(leaveYear),
      normalized.month - 1,
      normalized.day
    )
  );

  const nextStart = new Date(
    Date.UTC(
      Number(leaveYear) + 1,
      normalized.month - 1,
      normalized.day
    )
  );

  const end = new Date(nextStart);
  end.setUTCDate(end.getUTCDate() - 1);

  return { start, end };
}

export function getLeaveYearForDate(date, config) {
  const value = new Date(date);
  const normalized = normalizeLeaveYearStart(config);
  const calendarYear = value.getUTCFullYear();

  const thisYearStart = new Date(
    Date.UTC(
      calendarYear,
      normalized.month - 1,
      normalized.day
    )
  );

  return value >= thisYearStart
    ? calendarYear
    : calendarYear - 1;
}

export async function resolveLeaveYearForUser(
  user,
  date = new Date(),
  options = {}
) {
  const config = await getOrganizationLeaveYearConfig(
    user?.organizationId,
    options
  );

  return getLeaveYearForDate(date, config);
}

/*
 * Monthly proration requested by the confirmed requirements.
 * Fractions are always rounded DOWN.
 */
export function calculateProratedQuota({
  yearlyQuota,
  dateOfJoining,
  leaveYear,
  config,
}) {
  const quota = Number(yearlyQuota);

  if (!Number.isFinite(quota) || quota <= 0) {
    return 0;
  }

  if (!dateOfJoining) {
    return Math.floor(quota);
  }

  const joinDate = new Date(dateOfJoining);

  if (Number.isNaN(joinDate.getTime())) {
    return Math.floor(quota);
  }

  const { start, end } = getLeaveYearBounds(leaveYear, config);

  if (joinDate <= start) {
    return Math.floor(quota);
  }

  if (joinDate > end) {
    return 0;
  }

  const elapsedMonths =
    (joinDate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (joinDate.getUTCMonth() - start.getUTCMonth());

  const eligibleMonths = Math.max(
    0,
    Math.min(12, 12 - elapsedMonths)
  );

  return Math.floor((quota * eligibleMonths) / 12);
}
