import {
  AppError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';

/**
 * Spec Part 9.3 — centralized error middleware. Registered last, after all
 * routes. Never leaks stack traces or internal details to the client.
 */
export function errorHandler(err, req, res, _next) {
  console.error(err); // full detail server-side only

  if (err instanceof ValidationError) {
    return res.status(400).json({ success: false, message: err.message, errors: err.fields });
  }
  if (err instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: err.message });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  if (err instanceof ConflictError) {
    return res.status(409).json({ success: false, message: err.message });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }

  // Mongoose / Mongo native errors mapped onto the same vocabulary
  if (err.name === 'ValidationError') {
    const errors = Object.fromEntries(
      Object.entries(err.errors || {}).map(([k, v]) => [k, v.message])
    );
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid identifier' });
  }
  if (err.code === 11000) {
    return res
      .status(409)
      .json({ success: false, message: 'A record with that value already exists.' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File exceeds the 5MB limit.' });
  }

  return res
    .status(500)
    .json({ success: false, message: 'Something went wrong. Please try again.' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: 'Not found' });
}
