const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Role = require('../models/Role');
const { AppError, UnauthorizedError, ConflictError, ValidationError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');
const { sendWelcomeEmail } = require('../services/emailService');

function signAccessToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

function signRefreshToken(id) {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  });
}

function generateTempPassword(length = 12) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ValidationError('Email and password are required.');

  const user = await User.findOne({ email }).select('+password');
  if (!user) throw new UnauthorizedError('Invalid email or password.');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError('Account is temporarily locked. Try again later.');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= 5) {
      user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw new UnauthorizedError('Invalid email or password.');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  user.refreshToken = refreshToken;
  await user.save();

  const employee = await Employee.findOne({ user: user._id }).populate('role department designation grade');

  await logAudit({
    actor: employee?._id,
    actorRole: employee?.role?.name || user.role,
    action: 'login',
    description: `User ${email} logged in`,
    req,
  });

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    status: 'success',
    message: 'Login successful',
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        role: employee?.role?.name || user.role,
        employeeId: employee?.employeeId,
        name: employee ? `${employee.firstName} ${employee.lastName}` : '',
      },
    },
  });
});

exports.register = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, employeeId, joiningDate, roleName = 'Employee' } = req.body;
  if (!email || !password || !firstName || !lastName || !employeeId || !joiningDate) {
    throw new ValidationError('Missing required fields.');
  }

  const existing = await User.findOne({ email });
  if (existing) throw new ConflictError('Email already registered.');

  const existingEmp = await Employee.findOne({ $or: [{ employeeId }, { email }] });
  if (existingEmp) throw new ConflictError('Employee ID or email already exists.');

  const role = await Role.findOne({ name: roleName });
  if (!role) throw new ValidationError(`Role '${roleName}' not found.`);

  const user = await User.create({ email, password, role: roleName });
  const employee = await Employee.create({
    user: user._id,
    employeeId,
    firstName,
    lastName,
    email,
    joiningDate,
    role: role._id,
  });

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'create_employee',
    target: employee._id,
    targetModel: 'Employee',
    description: `Employee ${firstName} ${lastName} created`,
    req,
  });

  res.status(201).json({
    status: 'success',
    message: 'Account created. Please log in.',
    data: { userId: user._id, employeeId: employee._id },
  });
});

exports.logout = asyncHandler(async (req, res) => {
  if (req.user) {
    req.user.refreshToken = null;
    await req.user.save();
  }
  res.clearCookie('accessToken');
  res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
});

exports.refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new UnauthorizedError('Refresh token required.');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token.');
  }

  const user = await User.findById(decoded.id);
  if (!user || user.refreshToken !== refreshToken) {
    throw new UnauthorizedError('Invalid refresh token.');
  }

  const accessToken = signAccessToken(user._id);
  res.status(200).json({
    status: 'success',
    data: { accessToken },
  });
});

exports.getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    status: 'success',
    data: { user: req.user, employee: req.employee },
  });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ValidationError('Current and new passwords are required.');
  if (newPassword.length < 6) throw new ValidationError('New password must be at least 6 characters.');

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new UnauthorizedError('Current password is incorrect.');

  user.password = newPassword;
  await user.save();

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'password_change',
    description: 'User changed password',
    req,
  });

  res.status(200).json({ status: 'success', message: 'Password changed successfully.' });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(200).json({ status: 'success', message: 'If the email exists, a reset link has been sent.' });
  }

  const tempPassword = generateTempPassword();
  user.password = tempPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  await sendWelcomeEmail(email, user.email, tempPassword);

  res.status(200).json({ status: 'success', message: 'Temporary password sent to your email.' });
});
