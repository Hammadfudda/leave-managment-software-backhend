import Organization from '../models/Organization.js';
import LegacyOrganizationSettings from '../models/LegacyOrganizationSettings.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';

import {
  formatLeaveYearStart,
  getLegacyLeaveYearScopeKey,
  getOrganizationLeaveYearConfig,
  normalizeLeaveYearStart,
} from '../services/leaveYear.service.js';

export const getOrganizationSettings = asyncHandler(
  async (req, res) => {
    const config = await getOrganizationLeaveYearConfig(
      req.currentUser.organizationId
    );

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

    const organizationId = req.currentUser.organizationId;

    const previousConfig = await getOrganizationLeaveYearConfig(
      organizationId
    );

    const organization = organizationId
      ? await Organization.findById(organizationId)
      : null;

    let auditTargetType = 'Organization';
    let auditTargetId = organization?._id || req.currentUser._id;

    if (organization) {
      organization.leaveYearStartDay = config.day;
      organization.leaveYearStartMonth = config.month;

      await organization.save();
    } else {
      /*
       * Backward-compatible persistence for legacy/unscoped System Admin data.
       * Do NOT attach the old user to a newly-created tenant here; doing that
       * would hide existing organizationId=null Division/Department/Employee
       * records behind tenant filtering on the next request.
       */
      const legacy = await LegacyOrganizationSettings.findOneAndUpdate(
        {
          scopeKey: getLegacyLeaveYearScopeKey(organizationId),
        },
        {
          $set: {
            leaveYearStartDay: config.day,
            leaveYearStartMonth: config.month,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      auditTargetType = 'LegacyOrganizationSettings';
      auditTargetId = legacy._id;
    }

    /*
     * IMPORTANT:
     * Do not synchronously resync every employee here.
     *
     * The old implementation called
     * syncCurrentYearBalancesForAllEmployees() before sending the response.
     * On a real deployment that can take longer than the frontend's 15-second
     * Axios timeout, even though the Leave Year Start has already been saved.
     *
     * Balance/proration logic remains centralized in balance.service.js.
     * Whenever an employee balance is read, created, or otherwise synchronized,
     * syncPolicyBalancesForUser() recalculates the current-year Granted quota
     * using the latest organization Leave Year Start.
     */
    await audit({
      actorId: req.currentUser._id,
      actorName: req.currentUser.fullName,
      action: 'EDIT_LEAVE_YEAR_START',
      targetType: auditTargetType,
      targetId: auditTargetId,
      details: `Leave Year Start changed from ${formatLeaveYearStart(
        previousConfig
      )} to ${formatLeaveYearStart(
        config
      )}. Current employee balances will use the updated Leave Year Start on their next balance synchronization.`,
    });

    res.json({
      success: true,
      data: {
        leaveYearStartDay: config.day,
        leaveYearStartMonth: config.month,
        leaveYearStart: formatLeaveYearStart(config),
        balancesResynced: false,
        balanceResyncDeferred: true,
      },
    });
  }
);
