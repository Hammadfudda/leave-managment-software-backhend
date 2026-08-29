import { asyncHandler } from '../utils/asyncHandler.js';
import {
  adminStopApprovedLeave,
  overrideFinalDecision,
} from '../services/approval.service.js';

export const overrideDecision = asyncHandler(
  async (req, res) => {
    const request = await overrideFinalDecision(
      req.params.id,
      req.currentUser,
      req.body?.action,
      req.body?.reason
    );

    res.json({
      success: true,
      data: request,
    });
  }
);

export const stopApprovedLeave = asyncHandler(
  async (req, res) => {
    const request = await adminStopApprovedLeave(
      req.params.id,
      req.currentUser,
      req.body?.effectiveReturnDate,
      req.body?.reason
    );

    res.json({
      success: true,
      data: request,
    });
  }
);
