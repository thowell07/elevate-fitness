// The bounded tool loop: dictation in, validated items with code-computed
// macros out. The Anthropic client and fetch are injected so tests can fake them.

import { MealError, fromUpstreamError } from './errors.js';
import { totalsFor, withMacros } from './macros.js';
import { NUDGE_TEXT, SYSTEM_PROMPT, buildTools, buildUserMessage } from './prompt.js';
import { searchFoods } from './usda.js';
import { validateSubmission } from './validate.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_EFFORT = 'low';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const AGENT_LIMITS = Object.freeze({
  maxTurns: 6,
  maxTokens: 8000, // thinking counts toward this, so leave room beyond the answer
  callTimeoutMs: 20_000,
  deadlineMs: 40_000, // under the app's 45 s client timeout and the function's 60 s maxDuration
  usdaTimeoutMs: 8_000,
});

export function configFromEnv(env = process.env) {
  const effort = String(env.MEAL_EFFORT || DEFAULT_EFFORT).trim().toLowerCase();
  return {
    model: String(env.MEAL_MODEL || DEFAULT_MODEL).trim(),
    effort: EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT,
    webSearch: String(env.MEAL_WEB_SEARCH || 'on').trim().toLowerCase() !== 'off',
    webSearchToolType: env.MEAL_WEB_SEARCH_TOOL ? String(env.MEAL_WEB_SEARCH_TOOL).trim() : null,
    fdcApiKey: env.FDC_API_KEY || 'DEMO_KEY',
  };
}

function toolResult(id, content, isError = false) {
  const block = { type: 'tool_result', tool_use_id: id, content };
  if (isError) block.is_error = true;
  return block;
}

async function runLookup(block, { fetch, fdcApiKey, usdaTimeoutMs }) {
  const query = typeof block.input?.query === 'string' ? block.input.query.trim().slice(0, 200) : '';
  if (!query) return toolResult(block.id, 'lookup_food needs a non-empty query.', true);
  try {
    const foods = await searchFoods(query, { fetch, apiKey: fdcApiKey, timeoutMs: usdaTimeoutMs });
    if (!foods.length) return toolResult(block.id, JSON.stringify({ query, foods: [], hint: 'No USDA match. Try simpler words, or estimate.' }));
    return toolResult(block.id, JSON.stringify({ query, foods }));
  } catch (err) {
    return toolResult(block.id, `${err.message || 'USDA lookup failed.'} Use your own estimate and mark the item source "estimate".`, true);
  }
}

function countSearches(response) {
  const reported = response?.usage?.server_tool_use?.web_search_requests;
  if (typeof reported === 'number' && Number.isFinite(reported)) return reported;
  return (response?.content || []).filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').length;
}

// Returns { items, totals, meal, note, model, searches }.
export async function runMealAgent({
  text,
  draft = null,
  myFoods = [],
  myFoodsById = new Map(myFoods.map((f) => [f.id, f])),
  anthropic,
  fetch = globalThis.fetch,
  config = configFromEnv(),
  limits = AGENT_LIMITS,
  now = () => Date.now(),
  today = new Date().toISOString().slice(0, 10),
}) {
  const startedAt = now();
  // If the service rejects the request shape (400), step down once per rung and
  // try again: first without strict schemas, then also without web search.
  // Answers are validated in code either way.
  const rungs = [
    { name: 'full', tools: buildTools(config) },
    { name: 'no_strict', tools: buildTools({ ...config, strict: false }) },
    ...(config.webSearch ? [{ name: 'no_strict_no_web', tools: buildTools({ ...config, strict: false, webSearch: false }) }] : []),
  ];
  let rung = 0;
  const rejections = [];
  const messages = [{ role: 'user', content: buildUserMessage({ text, draft, myFoods, today }) }];
  let searches = 0;
  let nudged = false;
  let repairAsked = false;
  let servedModel = config.model;

  for (let turn = 0; turn < limits.maxTurns; turn += 1) {
    const remaining = limits.deadlineMs - (now() - startedAt);
    if (remaining < 3_000) throw new MealError(503, 'Reading the meal took too long. Try again.', { code: 'timeout' });

    let response;
    for (;;) {
      try {
        response = await anthropic.messages.create(
          {
            model: config.model,
            max_tokens: limits.maxTokens,
            // Automatic caching of the growing conversation within this loop,
            // plus an explicit breakpoint after the stable tools + system prefix.
            cache_control: { type: 'ephemeral' },
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            tools: rungs[rung].tools,
            tool_choice: { type: 'auto' },
            output_config: { effort: config.effort },
            messages,
          },
          { timeout: Math.min(limits.callTimeoutMs, remaining - 1_000), maxRetries: 1 },
        );
        break;
      } catch (err) {
        const mapped = fromUpstreamError(err);
        if (mapped.code !== 'upstream_rejected' || err?.status !== 400 || rung + 1 >= rungs.length) throw mapped;
        rejections.push(`${rungs[rung].name}: ${mapped.detail || '400'}`);
        rung += 1;
      }
    }

    if (response?.model) servedModel = response.model;
    searches += countSearches(response);
    const content = Array.isArray(response?.content) ? response.content : [];
    const stop = response?.stop_reason;

    if (stop === 'refusal') {
      throw new MealError(502, 'That could not be read as a meal. Try rewording it.', { code: 'refusal' });
    }
    if (stop === 'max_tokens') {
      throw new MealError(502, 'That meal was too long to read in one go. Try fewer items.', { code: 'max_tokens' });
    }
    if (stop === 'pause_turn') {
      // A server tool (web search) paused; send the turn back unchanged to resume.
      messages.push({ role: 'assistant', content });
      continue;
    }

    const toolUses = content.filter((b) => b.type === 'tool_use');
    const submit = toolUses.find((b) => b.name === 'submit_meal');
    if (submit) {
      try {
        const { items, meal, note } = validateSubmission(submit.input, myFoodsById);
        const computed = items.map(withMacros);
        return {
          items: computed,
          totals: totalsFor(computed),
          meal,
          note,
          model: servedModel,
          searches,
          // Server log only; the handler strips it before replying.
          degraded: rejections.length ? { rung: rungs[rung].name, rejections } : null,
        };
      } catch (err) {
        if (repairAsked || turn + 1 >= limits.maxTurns) throw err;
        repairAsked = true;
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: toolUses.map((b) => (b.id === submit.id
            ? toolResult(b.id, 'No usable items: every item needs a name, grams between 1 and 3000, and per100g values (kcal at most 900, macros in grams). Call submit_meal again with corrected items.', true)
            : toolResult(b.id, 'Skipped because submit_meal was called in the same turn.', true))),
        });
        continue;
      }
    }

    if (toolUses.length) {
      messages.push({ role: 'assistant', content });
      // All lookups from one turn run in parallel and go back in ONE user message.
      const results = await Promise.all(toolUses.map((block) => (block.name === 'lookup_food'
        ? runLookup(block, { fetch, fdcApiKey: config.fdcApiKey, usdaTimeoutMs: limits.usdaTimeoutMs })
        : Promise.resolve(toolResult(block.id, `Unknown tool ${block.name}.`, true)))));
      messages.push({ role: 'user', content: results });
      continue;
    }

    // end_turn (or anything else) without submit_meal: one nudge, then fail.
    if (nudged) break;
    nudged = true;
    if (content.length) messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: NUDGE_TEXT });
  }

  throw new MealError(502, 'The meal could not be read. Try saying it again.', { code: 'no_submission' });
}
