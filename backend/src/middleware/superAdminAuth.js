import jwt from 'jsonwebtoken';
import SuperAdmin from '../models/SuperAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function authenticateSuperAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Super Admin authentication required.',
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    if (payload.kind !== 'super_admin') {
      return res.status(401).json({
        success: false,
        message: 'Invalid Super Admin token.',
      });
    }

    req.superAdminAuth = payload;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired Super Admin token.',
    });
  }
}

export const loadSuperAdmin = asyncHandler(async (req, res, next) => {
  const superAdmin = await SuperAdmin.findById(req.superAdminAuth.id);

  if (!superAdmin || superAdmin.status !== 'active') {
    return res.status(401).json({
      success: false,
      message: 'Super Admin account is not active.',
    });
  }

  req.currentSuperAdmin = superAdmin;
  next();
});
