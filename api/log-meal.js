// POST /api/log-meal — Vercel Node function.
// Turns a dictated meal into food items with grams and code-computed macros.
// Server-only env: ANTHROPIC_API_KEY, FDC_API_KEY, MEAL_MODEL, MEAL_EFFORT,
// MEAL_WEB_SEARCH, MEAL_WEB_SEARCH_TOOL. Auth uses VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY and VITE_ALLOWED_EMAILS. Nothing is read at import time.

import { bearerToken, createVerifier } from './_lib/auth.js';
import { MealError, isMealError } from './_lib/errors.js';
import { configFromEnv, runMealAgent } from './_lib/mealAgent.js';
import { validateRequest } from './_lib/validate.js';

export const config = { maxDuration: 60 };

const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  // Vercel's Node helpers parse JSON bodies into req.body already.
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  let raw;
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new MealError(400, 'That request is too large.');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new MealError(400, 'That request is too large.');
  if (!raw.trim()) throw new MealError(400, 'Send the meal as JSON.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new MealError(400, 'Send the meal as JSON.');
  }
}

async function defaultVerifier(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createVerifier({
    supabaseUrl: env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_ANON_KEY,
    allowedEmails: env.VITE_ALLOWED_EMAILS,
    createClient,
  });
}

async function defaultAnthropic(env) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
}

// Factory so tests can inject auth, the Anthropic client and fetch.
export function createHandler({
  env = process.env,
  getVerifier = defaultVerifier,
  getAnthropic = defaultAnthropic,
  fetch = globalThis.fetch,
  logger = console,
} = {}) {
  let verifierPromise = null;
  let anthropicPromise = null;

  return async function handler(req, res) {
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new MealError(405, 'Use POST to log a meal.');
      }

      verifierPromise ||= Promise.resolve(getVerifier(env));
      const verify = await verifierPromise;
      await verify(bearerToken(req.headers || {}));

      const body = await readBody(req);
      const { text, draft, myFoods, myFoodsById } = validateRequest(body);

      if (!env.ANTHROPIC_API_KEY) {
        throw new MealError(503, 'Meal logging is not set up on the server yet.', { code: 'not_configured' });
      }
      anthropicPromise ||= Promise.resolve(getAnthropic(env));
      const anthropic = await anthropicPromise;

      const result = await runMealAgent({
        text,
        draft,
        myFoods,
        myFoodsById,
        anthropic,
        fetch,
        config: configFromEnv(env),
      });
      send(res, 200, result);
    } catch (err) {
      if (isMealError(err)) {
        if (err.status >= 500) logger.error?.(`log-meal ${err.status} ${err.code || ''} ${err.detail || ''}`.trim());
        send(res, err.status, { error: err.message });
        return;
      }
      // Unknown failure: log only the error class, never the message body or keys.
      logger.error?.(`log-meal unexpected ${err?.name || 'Error'}`);
      send(res, 502, { error: 'Something went wrong reading that meal. Try again.' });
    }
  };
}

export default createHandler();
