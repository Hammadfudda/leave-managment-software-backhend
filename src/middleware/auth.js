const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { UnauthorizedError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');

function getToken(req) {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  return token;
}

const protect = asyncHandler(async (req, res, next) => {
  const token = getToken(req);
  if (!token) {
    throw new UnauthorizedError('You are not logged in. Please log in to get access.');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired token. Please log in again.');
  }

  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User no longer exists or is deactivated.');
  }

  if (user.changedPasswordAfter(decoded.iat)) {
    throw new UnauthorizedError('Your password was changed recently. Please log in again.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError('Account is temporarily locked. Try again later.');
  }

  const employee = await Employee.findOne({ user: user._id })
    .populate('role')
    .populate('department')
    .populate('designation')
    .populate('grade')
    .populate('manager')
    .populate('teamLead');

  if (!employee) {
    throw new UnauthorizedError('Employee profile not found.');
  }

  req.user = user;
  req.employee = employee;
  req.token = decoded;
  next();
});

const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = getToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user && user.isActive) {
      const employee = await Employee.findOne({ user: user._id })
        .populate('role department designation grade manager teamLead');
      if (employee) {
        req.user = user;
        req.employee = employee;
      }
    }
  } catch (_) {
    // ignore
  }
  next();
});

module.exports = { protect, optionalAuth };
