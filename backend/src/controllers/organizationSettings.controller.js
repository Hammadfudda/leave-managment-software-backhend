import Organization from '../models/Organization.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { NotFoundError } from '../utils/errors.js';

import {
  syncCurrentYearBalancesForAllEmployees,
} from '../services/balance.service.js';

import {
  formatLeaveYearStart,
  normalizeLeaveYearStart,
} from '../services/leaveYear.service.js';

export const getOrganizationSettings = asyncHandler(
  async (req, res) => {
    const organization = await Organization.findById(
      req.currentUser.organizationId
    );

    if (!organization) {
      throw new NotFoundError('Organization not found.');
    }

    const config = normalizeLeaveYearStart({
      day: organization.leaveYearStartDay ?? 1,
      month: organization.leaveYearStartMonth ?? 1,
    });

    res.json({
      success: true,
      data: {
        leaveYearStartDay: config.day,
        leaveYearStartMonth: config.month,
        leaveYearStart: formatLeaveYearStart(config),
      },
    });
  }
);

export const updateOrganizationSettings = asyncHandler(
  async (req, res) => {
    const config = normalizeLeaveYearStart({
      day: req.body?.leaveYearStartDay,
      month: req.body?.leaveYearStartMonth,
    });

    const organization = await Organization.findById(
      req.currentUser.organizationId
    );

    if (!organization) {
      throw new NotFoundError('Organization not found.');
    }

    const previous = formatLeaveYearStart({
      day: organization.leaveYearStartDay ?? 1,
      month: organization.leaveYearStartMonth ?? 1,
    });

    organization.leaveYearStartDay = config.day;
    organization.leaveYearStartMonth = config.month;

    await organization.save();

    /*
     * Existing balance.service.js is the only source of truth for quotas.
     * Re-run it after the organization Leave Year Start changes so current
     * employees immediately receive the correct prorated Granted values.
     *
     * This is best-effort so one unrelated legacy employee/policy problem
     * cannot roll back or hide a successfully saved organization setting.
     * Any later balance read also self-syncs through the same service.
     */
    let balancesResynced = true;
    let balanceResyncWarning = '';

    try {
      await syncCurrentYearBalancesForAllEmployees();
    } catch (error) {
      balancesResynced = false;
      balanceResyncWarning =
        error?.message ||
        'One or more employee balances could not be refreshed immediately.';

      console.error(
        'Leave Year Start saved, but immediate balance resync failed:',
        error
      );
    }

    await audit({
      actorId: req.currentUser._id,
      actorName: req.currentUser.fullName,
      action: 'EDIT_LEAVE_YEAR_START',
      targetType: 'Organization',
      targetId: organization._id,
      details: `Leave Year Start changed from ${previous} to ${formatLeaveYearStart(
        config
      )}. Current employee balance resync: ${
        balancesResynced ? 'completed' : 'warning'
      }.`,
    });

    res.json({
      success: true,
      data: {
        leaveYearStartDay: config.day,
        leaveYearStartMonth: config.month,
        leaveYearStart: formatLeaveYearStart(config),
        balancesResynced,
        balanceResyncWarning:
          balanceResyncWarning || undefined,
      },
    });
  }
);
