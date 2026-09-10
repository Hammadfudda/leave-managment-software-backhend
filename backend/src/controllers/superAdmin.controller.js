import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import SuperAdmin from '../models/SuperAdmin.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { sendEmail, templates } from '../services/email.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => String(v ?? '').trim();
const normalizeEmail = (v) => clean(v).toLowerCase();
const makeSlug = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const publicSuperAdmin = (a) => ({ id: String(a._id), fullName: a.fullName, email: a.email });
function publicOrganization(o) { const a=o.adminUserId; return {id:String(o._id),name:o.name,slug:o.slug,status:o.status,createdAt:o.createdAt,updatedAt:o.updatedAt,admin:a&&typeof a==='object'?{id:String(a._id),fullName:a.fullName,email:a.email,status:a.status}:null}; }

export const setupFirstSuperAdmin = asyncHandler(async (req,res)=>{
  const fullName=clean(req.body.fullName)||'SaaS Owner', email=normalizeEmail(req.body.email), password=String(req.body.password||'');
  if(!email||!password) throw new ValidationError('Email and password are required.');
  if(!EMAIL_RE.test(email)) throw new ValidationError('Email is invalid.');
  if(password.length<10) throw new ValidationError('Password must be at least 10 characters.');
  if(await SuperAdmin.countDocuments()>0) return res.status(403).json({success:false,message:'Super Admin setup is already completed. Use the Super Admin login endpoint.'});
  const superAdmin=await SuperAdmin.create({fullName,email,passwordHash:await bcrypt.hash(password,12),status:'active'});
  return res.status(201).json({success:true,message:'First Super Admin created successfully.',user:publicSuperAdmin(superAdmin)});
});

export const login = asyncHandler(async (req,res)=>{
  const email=normalizeEmail(req.body.email), password=String(req.body.password||'');
  if(!email||!password) throw new ValidationError('Email and password are required.');
  const superAdmin=await SuperAdmin.findOne({email,status:'active'});
  const invalid=()=>res.status(401).json({success:false,message:'Invalid credentials.'});
  if(!superAdmin) return invalid();
  if(!(await bcrypt.compare(password,superAdmin.passwordHash))) return invalid();
  superAdmin.lastLoginAt=new Date(); await superAdmin.save();
  const accessToken=jwt.sign({id:String(superAdmin._id),kind:'super_admin'},process.env.JWT_ACCESS_SECRET,{expiresIn:'8h'});
  return res.json({success:true,accessToken,user:publicSuperAdmin(superAdmin)});
});

export const me=asyncHandler(async(req,res)=>res.json({success:true,user:publicSuperAdmin(req.currentSuperAdmin)}));
export const listOrganizations=asyncHandler(async(_req,res)=>{const rows=await Organization.find({}).populate('adminUserId','fullName email status').sort({createdAt:-1});return res.json({success:true,data:rows.map(publicOrganization)});});
export const updateOrganizationStatus=asyncHandler(async(req,res)=>{const status=clean(req.body.status).toLowerCase();if(!['active','suspended'].includes(status))throw new ValidationError('Status must be active or suspended.');const o=await Organization.findById(req.params.id);if(!o)throw new NotFoundError('Organization not found.');o.status=status;await o.save();await User.updateMany({organizationId:o._id},{$set:{refreshTokenHash:null}});const p=await Organization.findById(o._id).populate('adminUserId','fullName email status');return res.json({success:true,data:publicOrganization(p)});});
export const createOrganization=asyncHandler(async(req,res)=>{const companyName=clean(req.body.companyName),adminName=clean(req.body.adminName),adminEmail=normalizeEmail(req.body.adminEmail),password=String(req.body.password||'');if(!companyName||!adminName||!adminEmail||!password)throw new ValidationError('Company name, Admin name, Admin email and password are required.');if(!EMAIL_RE.test(adminEmail))throw new ValidationError('Admin email is invalid.');if(password.length<8)throw new ValidationError('Admin password must be at least 8 characters.');if(await User.exists({email:adminEmail}))throw new ConflictError('A user with this Admin email already exists.');let slug=makeSlug(companyName)||'client',baseSlug=slug,counter=2;while(await Organization.exists({slug})){slug=`${baseSlug}-${counter++}`;}const o=await Organization.create({name:companyName,slug,status:'active',createdBySuperAdminId:req.currentSuperAdmin._id});try{const shortId=String(o._id).slice(-8);const u=await User.create({fullName:adminName,email:adminEmail,nationalId:`SAAS-ADMIN-${shortId}`,passwordHash:await bcrypt.hash(password,12),passwordChangedFromDefault:true,role:'admin',organizationId:o._id,employeeId:`ADMIN-${shortId.toUpperCase()}`,cnic:'',designation:'Administrator',department:'Administration',gradeId:null,managerId:null,canApproveOtherDepartments:true,dateOfJoining:new Date(),detailsStatus:'complete',pendingFields:[],status:'active'});o.adminUserId=u._id;await o.save();const p=await Organization.findById(o._id).populate('adminUserId','fullName email status');const emailSent=await sendEmail({to:adminEmail,subject:'Your Leave Management Admin account is ready',html:templates.clientAdminCreated({adminName,companyName,email:adminEmail,password})});return res.status(201).json({success:true,data:publicOrganization(p),credentials:{email:adminEmail,password,emailSent},emailSent});}catch(e){await Organization.findByIdAndDelete(o._id);throw e;}});
export const resetClientAdminPassword=asyncHandler(async(req,res)=>{const password=String(req.body.password||'');if(password.length<8)throw new ValidationError('Password must be at least 8 characters.');const o=await Organization.findById(req.params.id);if(!o||!o.adminUserId)throw new NotFoundError('Client Admin was not found.');const a=await User.findById(o.adminUserId);if(!a)throw new NotFoundError('Client Admin was not found.');a.passwordHash=await bcrypt.hash(password,12);a.passwordChangedFromDefault=true;a.refreshTokenHash=null;a.failedLoginAttempts=0;a.lockedUntil=null;await a.save();return res.json({success:true,message:'Client Admin password updated.',credentials:{email:a.email,password}});});
