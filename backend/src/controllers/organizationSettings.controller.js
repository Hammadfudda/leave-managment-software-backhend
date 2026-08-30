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

    const changed =
      Number(previousConfig.day) !==
        Number(config.day) ||
      Number(previousConfig.month) !==
        Number(config.month);

    if (!changed) {
      return res.json({
        success: true,
        data: {
          leaveYearStartDay: previousConfig.day,
          leaveYearStartMonth: previousConfig.month,
          leaveYearStart: formatLeaveYearStart(previousConfig),
          unchanged: true,
        },
      });
    }

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
       * Do NOT attach the old user to a newly-created tenant here.
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
     * Do not synchronously resync every employee here.
     * Balance/proration remains centralized in balance.service.js and uses
     * the latest Start year date on the next balance synchronization/read.
     */
    await audit({
      actorId: req.currentUser._id,
      actorName: req.currentUser.fullName,
      action: 'EDIT_LEAVE_YEAR_START',
      targetType: auditTargetType,
      targetId: auditTargetId,
      details: `Start year date changed from ${formatLeaveYearStart(
        previousConfig
      )} to ${formatLeaveYearStart(
        config
      )}. Current employee balances will use the updated Start year date on their next balance synchronization.`,
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
