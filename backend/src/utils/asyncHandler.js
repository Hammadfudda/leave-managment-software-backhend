/**
 * Wraps a controller so any thrown error / rejected promise reaches the
 * centralized error middleware instead of crashing or hanging the request.
 * Spec Part 9.3.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
