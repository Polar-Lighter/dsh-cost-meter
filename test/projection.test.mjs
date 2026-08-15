// Node-side test for the host projection unit (lib/projection.js):
// folds session events into per-model token buckets (multi-model sessions,
// same-step sample replacement, model switches mid-session).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve the package through the DSH profile (zod resolves there), then load
// the projection module by absolute file URL so its own zod import resolves.
const req = createRequire("C:/Users/Lenovo/.dsh/profiles/web/x.js");
const pkgDir = dirname(req.resolve("dsh-cost-meter/package.json"));
const mod = await import(pathToFileURL(join(pkgDir, "lib", "projection.js")));
const def = mod.tokenUsageByModelProjectionDefinition;

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };

const fold = (events) => {
  let state = def.init();
  for (const e of events) state = def.apply(state, e);
  return def.view(state);
};

// ── multi-model session, with same-step sample replacement ──────────────────
const events = [
  { type: "request/header", data: { header: { config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }, reason: "initial" } },
  { type: "step/start", data: { turn: 1, step: 1 } },
  // early usage chunk …
  { type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 0 } } } },
  // … replaced by the finalized message for the SAME step (no double count)
  { type: "assistant/message", data: { turn: 1, step: 1, message: {}, usage: { inputTokens: 120, outputTokens: 60, cacheReadTokens: 12, cacheWriteTokens: 3 } } },
  { type: "step/end", data: { turn: 1, step: 1 } },
  // model switch mid-session
  { type: "request/header", data: { header: { config: { provider: "deepseek-official", model: "deepseek-v4-pro" } }, reason: "change" } },
  { type: "step/start", data: { turn: 1, step: 2 } },
  { type: "assistant/message", data: { turn: 1, step: 2, message: {}, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  { type: "step/end", data: { turn: 1, step: 2 } },
  // a usage-less message must not crash or add anything
  { type: "assistant/message", data: { turn: 1, step: 3, message: {} } },
];

const view = fold(events);
assert(view.models.length === 2, `expected 2 models, got ${JSON.stringify(view.models)}`);
const byName = Object.fromEntries(view.models.map((m) => [m.model, m]));
const flash = byName["deepseek-v4-flash"];
const pro = byName["deepseek-v4-pro"];
assert(flash && flash.uncachedInputTokens === 120 && flash.outputTokens === 60 && flash.cacheReadTokens === 12 && flash.cacheWriteTokens === 3,
  `flash buckets wrong: ${JSON.stringify(flash)}`);
assert(pro && pro.uncachedInputTokens === 200 && pro.outputTokens === 100 && pro.cacheReadTokens === 0 && pro.cacheWriteTokens === 0,
  `pro buckets wrong: ${JSON.stringify(pro)}`);

// ── empty log ──────────────────────────────────────────────────────────────
assert(fold([]).models.length === 0, "empty log → no models");

// ── same-step replace, standalone ──────────────────────────────────────────
{
  const v = fold([
    { type: "request/header", data: { header: { config: { model: "deepseek-v4-flash" } } } },
    { type: "assistant/message", data: { turn: 1, step: 1, message: {}, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 } } },
    { type: "assistant/message", data: { turn: 1, step: 1, message: {}, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 } } }, // identical repeat → no change
  ]);
  assert(v.models[0].uncachedInputTokens === 10 && v.models[0].outputTokens === 5, `repeat must not double count: ${JSON.stringify(v.models)}`);
}

// ── model ordering (sorted by name) ────────────────────────────────────────
{
  const v = fold([
    { type: "request/header", data: { header: { config: { model: "deepseek-v4-pro" } } } },
    { type: "assistant/message", data: { turn: 1, step: 1, message: {}, usage: { inputTokens: 1, outputTokens: 1 } } },
    { type: "request/header", data: { header: { config: { model: "deepseek-v4-flash" } } } },
    { type: "assistant/message", data: { turn: 2, step: 1, message: {}, usage: { inputTokens: 1, outputTokens: 1 } } },
  ]);
  assert(v.models[0].model === "deepseek-v4-flash" && v.models[1].model === "deepseek-v4-pro", `sorted order wrong: ${JSON.stringify(v.models)}`);
}

console.log("ALL TESTS PASSED — tokenUsageByModel projection unit OK");
