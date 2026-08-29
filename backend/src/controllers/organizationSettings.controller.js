import Organization from '../models/Organization.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { NotFoundError } from '../utils/errors.js';
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

    await audit({
      actorId: req.currentUser._id,
      actorName: req.currentUser.fullName,
      action: 'EDIT_LEAVE_YEAR_START',
      targetType: 'Organization',
      targetId: organization._id,
      details: `Leave Year Start changed from ${previous} to ${formatLeaveYearStart(
        config
      )}.`,
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
