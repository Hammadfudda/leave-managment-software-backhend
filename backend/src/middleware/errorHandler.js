import {
  AppError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils/errors.js';

export function errorHandler(
  err,
  req,
  res,
  _next
) {
  console.error(
    '===== API ERROR ====='
  );

  console.error(
    'Method:',
    req.method
  );

  console.error(
    'URL:',
    req.originalUrl
  );

  console.error(
    'Error name:',
    err?.name
  );

  console.error(
    'Error message:',
    err?.message
  );

  console.error(
    '====================='
  );

  if (
    err instanceof
    ValidationError
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message:
          err.message,
        errors:
          err.fields,
      });
  }

  if (
    err instanceof
    ForbiddenError
  ) {
    return res
      .status(403)
      .json({
        success: false,
        message:
          err.message,
      });
  }

  if (
    err instanceof
    NotFoundError
  ) {
    return res
      .status(404)
      .json({
        success: false,

        message:
          err.message ||
          'Not found',

        debug: {
          type:
            'NotFoundError',

          method:
            req.method,

          path:
            req.originalUrl,
        },
      });
  }

  if (
    err instanceof
    ConflictError
  ) {
    return res
      .status(409)
      .json({
        success: false,
        message:
          err.message,
      });
  }

  if (
    err instanceof
    AppError
  ) {
    return res
      .status(
        err.status
      )
      .json({
        success: false,
        message:
          err.message,
      });
  }

  if (
    err?.name ===
    'ValidationError'
  ) {
    const errors =
      Object.fromEntries(
        Object.entries(
          err.errors || {}
        ).map(
          ([key, value]) => [
            key,
            value.message,
          ]
        )
      );

    return res
      .status(400)
      .json({
        success: false,
        message:
          'Validation failed',
        errors,
      });
  }

  if (
    err?.name ===
    'CastError'
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message:
          'Invalid identifier',
      });
  }

  if (
    err?.code ===
    11000
  ) {
    return res
      .status(409)
      .json({
        success: false,
        message:
          'A record with that value already exists.',
      });
  }

  if (
    err?.code ===
    'LIMIT_FILE_SIZE'
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message:
          'File exceeds the 5MB limit.',
      });
  }

  return res
    .status(500)
    .json({
      success: false,

      message:
        'Something went wrong. Please try again.',

      debug: {
        method:
          req.method,

        path:
          req.originalUrl,

        error:
          err?.message ||
          'Unknown error',
      },
    });
}

export function notFoundHandler(
  req,
  res
) {
  console.error(
    '===== ROUTE NOT FOUND ====='
  );

  console.error(
    'Method:',
    req.method
  );

  console.error(
    'URL:',
    req.originalUrl
  );

  console.error(
    '==========================='
  );

  return res
    .status(404)
    .json({
      success: false,

      message:
        `Route not found: ${req.method} ${req.originalUrl}`,

      debug: {
        type:
          'RouteNotFound',

        method:
          req.method,

        path:
          req.originalUrl,
      },
    });
}