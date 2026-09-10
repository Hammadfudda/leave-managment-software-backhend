import jwt from 'jsonwebtoken';
import SuperAdmin from '../models/SuperAdmin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export function authenticateSuperAdmin(req,res,next){const h=req.headers.authorization;const token=h?.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({success:false,message:'Super Admin authentication required.'});try{const p=jwt.verify(token,process.env.JWT_ACCESS_SECRET);if(p.kind!=='super_admin')return res.status(401).json({success:false,message:'Invalid Super Admin token.'});req.superAdminAuth=p;return next();}catch{return res.status(401).json({success:false,message:'Invalid or expired Super Admin token.'});}}
export const loadSuperAdmin=asyncHandler(async(req,res,next)=>{const a=await SuperAdmin.findById(req.superAdminAuth.id);if(!a||a.status!=='active')return res.status(401).json({success:false,message:'Super Admin account is not active.'});req.currentSuperAdmin=a;next();});
