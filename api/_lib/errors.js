// An error whose message is safe to show the owner. Anything else that reaches
// the handler is reported with a generic sentence.
export class MealError extends Error {
  constructor(status, message, { code } = {}) {
    super(message);
    this.name = 'MealError';
    this.status = status;
    this.code = code || null;
  }
}

export const isMealError = (err) => err instanceof MealError;

// Maps an Anthropic SDK error (or a network failure) to a MealError. Uses the
// numeric status the SDK puts on every APIError, so it works with any SDK
// version and with fakes in tests.
export function fromUpstreamError(err) {
  if (isMealError(err)) return err;
  const status = typeof err?.status === 'number' ? err.status : null;
  const name = String(err?.name || err?.constructor?.name || '');
  if (status === 429) {
    return new MealError(429, 'The meal service is busy right now. Try again in a minute.', { code: 'rate_limited' });
  }
  if (status === 529 || (status !== null && status >= 500)) {
    return new MealError(503, 'The meal service is temporarily unavailable. Try again.', { code: 'upstream_unavailable' });
  }
  if (status === null && /timeout|abort/i.test(name)) {
    return new MealError(503, 'Reading the meal took too long. Try again.', { code: 'timeout' });
  }
  if (status === null) {
    return new MealError(503, 'The meal service could not be reached. Try again.', { code: 'upstream_unreachable' });
  }
  // 400/401/403/404/413 from upstream mean a server configuration problem.
  return new MealError(502, 'Meal logging hit a server problem. Try again later.', { code: 'upstream_rejected' });
}
