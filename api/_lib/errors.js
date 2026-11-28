// An error whose message is safe to show the owner. Anything else that reaches
// the handler is reported with a generic sentence.
export class MealError extends Error {
  constructor(status, message, { code, detail } = {}) {
    super(message);
    this.name = 'MealError';
    this.status = status;
    this.code = code || null;
    // Server log only. Never sent to the browser.
    this.detail = detail || null;
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
  // 400/401/402/403/404/413 from upstream mean a server configuration problem.
  // The owner is the only user, so the message names what to check. The
  // upstream wording goes to the server log, with anything key-shaped removed.
  const detail = upstreamDetail(err, status);
  const upstreamText = String(err?.error?.error?.message || err?.message || '');
  if (status === 401) {
    return new MealError(502, 'The meal service rejected the API key. Check ANTHROPIC_API_KEY in Vercel.', { code: 'upstream_auth', detail });
  }
  if (status === 402 || /credit balance|billing/i.test(upstreamText)) {
    return new MealError(502, 'The API account has no credit available. Check billing on the Claude Platform.', { code: 'upstream_billing', detail });
  }
  if (status === 403) {
    return new MealError(502, 'The API key is not allowed to make this request. Check the key and its workspace on the Claude Platform.', { code: 'upstream_forbidden', detail });
  }
  return new MealError(502, 'Meal logging hit a server problem. Try again later.', { code: 'upstream_rejected', detail });
}

const redact = (text) => String(text || '').replace(/sk-ant-[A-Za-z0-9_-]*/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 400);

function upstreamDetail(err, status) {
  const type = err?.type || err?.error?.error?.type || '';
  const requestId = err?.requestID || err?.request_id || err?.error?.request_id || '';
  const message = err?.error?.error?.message || err?.message || '';
  return redact(`upstream ${status} ${type} ${requestId} ${message}`);
}
