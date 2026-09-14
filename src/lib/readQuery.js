// Retry only reads. A timed-out mutation may have reached the server already.
export const readQuery = async (makeQuery, { attempts = 3, timeoutMs = 10000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let result;
    try {
      const query = makeQuery();
      // Own the retry budget instead of multiplying the SDK's internal attempts.
      if (typeof query.retry === 'function') query.retry(false);
      result = await query.abortSignal(controller.signal);
    }
    catch (error) { result = { error, status: 0 }; }
    finally { clearTimeout(timeout); }
    if (!result.error) return result;
    const transient = !result.status || result.status === 408 || result.status === 429 || result.status >= 500;
    if (!transient || attempt === attempts - 1) return result;
    await wait(attempt === 0 ? 400 : 1200);
  }
};
