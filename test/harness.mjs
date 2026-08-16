// Node-side smoke test for dsh-cost-meter's client bundle:
//  - loads lib/client.js with a fake window.__ModuleLoader__ + stubs,
//  - exercises pricing (flat / peak / off-peak), cost math, stats fold,
//  - verifies both slot registrations (dock hidden, context-panel detail)
//    and renders the detail block with data.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load(handoff) {
      if (handoff.id !== "dsh-cost-meter") throw new Error(`unexpected id: ${handoff.id}`);
      loaded = handoff.factory(requireShim);
    },
  },
};

// require shim: react only.
function requireShim(spec) {
  if (spec === "react") {
    return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useMemo: (fn) => fn(),
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useEffect: () => {},
    };
  }
  throw new Error(`unexpected require: ${spec}`);
}

const code = readFileSync(bundlePath, "utf8");
new Function(code)(); // execute bundle (registers factory, runs side effects)

if (!loaded || typeof loaded.apply !== "function") throw new Error("bundle did not export apply");
if (!Array.isArray(loaded.inject) || !loaded.inject.includes("slots") || !loaded.inject.includes("connection")) throw new Error("inject must declare slots + connection");

const { costOf, formatCost, formatUsd, priceOf, isBeijingPeak, PEAK_OFFPEAK_START_UTC, deriveStats, formatTokens, BalanceBlock, formatAmount, formatClock, currencySymbol } = loaded;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };

// Fixed evaluation times (all Beijing = UTC+8):
const t = (iso) => new Date(iso);
const FLAT = t("2026-08-15T10:00:00+08:00");          // before 8-17 cutoff → flat
const PEAK = t("2026-08-17T11:00:00+08:00");           // after cutoff, 9-12 → peak
const OFF = t("2026-08-17T08:00:00+08:00");            // after cutoff, morning → off-peak

// ── peak-window boundaries (Beijing time) ──────────────────────────────────
assert(isBeijingPeak(t("2026-08-17T09:00:00+08:00")) === true, "09:00 is peak");
assert(isBeijingPeak(t("2026-08-17T11:59:00+08:00")) === true, "11:59 is peak");
assert(isBeijingPeak(t("2026-08-17T12:00:00+08:00")) === false, "12:00 is NOT peak");
assert(isBeijingPeak(t("2026-08-17T14:00:00+08:00")) === true, "14:00 is peak");
assert(isBeijingPeak(t("2026-08-17T17:59:00+08:00")) === true, "17:59 is peak");
assert(isBeijingPeak(t("2026-08-17T18:00:00+08:00")) === false, "18:00 is NOT peak");
assert(isBeijingPeak(t("2026-08-17T03:00:00+08:00")) === false, "03:00 is off-peak");

// ── regime selection ───────────────────────────────────────────────────────
assert(priceOf("deepseek-v4-flash", FLAT).tier === "flat", "before cutoff → flat");
assert(priceOf("deepseek-v4-flash", PEAK).tier === "peak", "after cutoff + peak hours → peak");
assert(priceOf("deepseek-v4-flash", OFF).tier === "offpeak", "after cutoff + off hours → offpeak");
assert(priceOf("unknown-model", PEAK).model === "deepseek-v4-flash", "unknown model falls back to flash tier");

// ── cost math, deepseek-v4-flash (CNY + USD) ───────────────────────────────
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-flash", FLAT);
  assert(c && Math.abs(c.total - (1.0 + 0.02 + 2.0)) < 1e-9, `flash flat CNY should be ￥3.02, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (0.14 + 0.0028 + 0.28)) < 1e-9, `flash flat USD should be $0.4228, got ${c && c.totalUsd}`);
  const w = costOf({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000, outputTokens: 0 }, "deepseek-v4-flash", FLAT);
  assert(w && Math.abs(w.total - 1.0) < 1e-9, `flash flat cache-write CNY should be ￥1.0, got ${w && w.total}`);
  assert(w && Math.abs(w.totalUsd - 0.14) < 1e-9, `flash flat cache-write USD should be $0.14, got ${w && w.totalUsd}`);
}
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-flash", PEAK);
  assert(c && Math.abs(c.total - (3.0 + 0.1 + 9.0)) < 1e-9, `flash peak CNY should be ￥12.1, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (0.44 + 0.014 + 1.32)) < 1e-9, `flash peak USD should be $1.774, got ${c && c.totalUsd}`);
}
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-flash", OFF);
  assert(c && Math.abs(c.total - (1.5 + 0.05 + 4.5)) < 1e-9, `flash off-peak CNY should be ￥6.05, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (0.22 + 0.007 + 0.66)) < 1e-9, `flash off-peak USD should be $0.887, got ${c && c.totalUsd}`);
}

// ── cost math, deepseek-v4-pro (CNY + USD) ─────────────────────────────────
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-pro", FLAT);
  assert(c && Math.abs(c.total - 9.0) < 1e-9, `pro flat CNY (3+6) should be ￥9.0, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (0.435 + 0.87)) < 1e-9, `pro flat USD (0.435+0.87) should be $1.305, got ${c && c.totalUsd}`);
}
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-pro", PEAK);
  assert(c && Math.abs(c.total - 36.0) < 1e-9, `pro peak CNY (9+27) should be ￥36.0, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (1.32 + 3.96)) < 1e-9, `pro peak USD (1.32+3.96) should be $5.28, got ${c && c.totalUsd}`);
}
{
  const c = costOf({ uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 }, "deepseek-v4-pro", OFF);
  assert(c && Math.abs(c.total - 18.0) < 1e-9, `pro off-peak CNY (4.5+13.5) should be ￥18.0, got ${c && c.total}`);
  assert(c && Math.abs(c.totalUsd - (0.66 + 1.98)) < 1e-9, `pro off-peak USD (0.66+1.98) should be $2.64, got ${c && c.totalUsd}`);
}

// ── edge cases ─────────────────────────────────────────────────────────────
{
  assert(costOf({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, "deepseek-v4-flash", PEAK) === null, "zero usage must return null");
  assert(costOf(undefined, "deepseek-v4-flash", PEAK) === null, "undefined usage must return null");
  assert(PEAK_OFFPEAK_START_UTC === Date.UTC(2026, 7, 16, 16, 0, 0), "cutoff must be 2026-08-16T16:00Z (= 8-17 00:00 +08)");
}

// ── formatting ─────────────────────────────────────────────────────────────
assert(formatCost(0) === "￥0", "formatCost(0)");
assert(formatCost(0.0032) === "￥0.0032", "formatCost(0.0032)");
assert(formatCost(1.23) === "￥1.23", "formatCost(1.23)");
assert(formatCost(0.00005) === "￥<0.0001", "formatCost tiny");
assert(formatCost(12.5) === "￥12.5", "formatCost(12.5)");
assert(formatUsd(0) === "$ 0", "formatUsd(0)");
assert(formatUsd(0.0032) === "$ 0.0032", "formatUsd(0.0032)");
assert(formatUsd(8.54) === "$ 8.54", "formatUsd(8.54)");
assert(formatUsd(0.00005) === "$ <0.0001", "formatUsd tiny");
assert(formatTokens(517) === "517" && formatTokens(12200) === "12.2K" && formatTokens(1234567) === "1.2M", "formatTokens");

// ── stats fold ─────────────────────────────────────────────────────────────
{
  const nodes = [
    { kind: "assistant", turn: 1, step: 1, timing: { stepStartTime: 0, firstTokenTime: 500, completedTime: 2500 }, usage: { outputTokens: 100 } },
    { kind: "assistant", turn: 2, step: 1, timing: { stepStartTime: 0, firstTokenTime: null, completedTime: 1000 }, usage: { outputTokens: 50 } },
    { kind: "tool-result", time: 3000, callTime: 2000 },
  ];
  const s = deriveStats(nodes);
  assert(s.turns === 2 && s.steps === 2, "deriveStats turns/steps");
  assert(s.llmMs === 3500, `deriveStats llmMs=${s.llmMs}`);
  assert(s.toolMs === 1000, `deriveStats toolMs=${s.toolMs}`);
  assert(s.ttftMs === 500 && s.ttftSteps === 1, "deriveStats ttft");
  assert(s.decodeMs === 2000 && s.decodeTokens === 100, "deriveStats decode");
}

// ── apply surface: hide dock + context-panel detail ────────────────────────
{
  const registers = [];
  const slots = {
    inject(key, cb) {
      if (!["conversation.composer.dock", "conversation.context.detail"].includes(key)) throw new Error(`unexpected slot key: ${key}`);
      cb(); // declarations already exist in this smoke test
    },
    register(opts, component) {
      registers.push({ opts, component });
      return () => {};
    },
  };
  loaded.apply({ slots });
  assert(registers.length === 2, `expected exactly two register calls, got ${registers.length}`);

  const dock = registers.find((r) => r.opts.name === "conversation.composer.dock");
  const detail = registers.find((r) => r.opts.name === "conversation.context.detail");
  assert(dock && dock.opts.id === "stats" && dock.opts.priority === -1, "dock entry must shadow id=stats at priority -1");
  assert(detail, "detail entry must register into conversation.context.detail");
  assert(dock.component({}) === null, "dock shadow component must render null (hide bottom bar)");

  // Render the detail block with data.
  const el = detail.component({
    useProjection: (key) => {
      if (key === "sessionStats") return { turns: 3, steps: 5, llmMs: 150_000, toolMs: 20_000, ttftMs: 1_200, ttftSteps: 4, decodeMs: 30_000, decodeTokens: 1500 };
      if (key === "tokenUsage") return { uncachedInputTokens: 500_000, cacheReadTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 300_000 };
      return undefined;
    },
    useSession: () => [
      { kind: "assistant", turn: 1, step: 1, provenance: { provider: "deepseek-official", model: "deepseek-v4-pro" }, timing: null, usage: null },
    ],
  });

  const textOf = (node) => {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "string" || typeof node === "number") return String(node ?? "");
    const kids = Array.isArray(node.children) ? node.children : [];
    return kids.map(textOf).join("");
  };
  const text = textOf(el);

  assert(el.type === "div" && el.props.className === "dshcm-detail", "root must be div.dshcm-detail");

  // Template structure: each section is [divider, header, divider, content…];
  // the cost section is [divider, 费用, divider, value, divider].
  const kids = (Array.isArray(el.children) ? el.children : [el.children]).flat();
  const byClass = (cls) => kids.filter((k) => k && k.props && typeof k.props.className === "string" && k.props.className.split(" ").includes(cls));
  const textOfClass = (cls) => byClass(cls).map(textOf);

  assert(byClass("dshcm-divider").length === 7, `expected 7 dividers, got ${byClass("dshcm-divider").length}`);

  const headers = textOfClass("dshcm-detailTitle");
  assert(headers.length === 3, `expected 3 headers, got ${JSON.stringify(headers)}`);
  assert(headers[0] === "会话统计", `header[0]=${headers[0]}`);
  assert(headers[1] === "Token 用量", `header[1]=${headers[1]}`);
  assert(headers[2] === "费用", `header[2]=${headers[2]}`);

  const rows = textOfClass("dshcm-detailRow");
  const expectRows = [
    "3 轮 · 5 步",                                   // counts alone
    "LLM 2m30s · 工具调用 20s",                      // durations alone
    "首 token 平均 0.3s · 50 tok/s",                 // speeds alone (1500/30s)
    "命中 200K · 未命中 500K · 写入 100K",           // hit/uncached/write
    "输出 300K tok",                                  // output alone
    "缓存命中率 25%",                                 // hit rate alone
  ];
  assert(rows.length === expectRows.length, `expected ${expectRows.length} rows, got ${JSON.stringify(rows)}`);
  for (let i = 0; i < expectRows.length; i++) {
    assert(rows[i] === expectRows[i], `row[${i}] expected "${expectRows[i]}", got "${rows[i]}"`);
  }

  // 费用 value on its own line, in both currencies, font styled (dshcm-costValue).
  const usageData = { uncachedInputTokens: 500_000, cacheReadTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 300_000 };
  const costNow = costOf(usageData, "deepseek-v4-pro", new Date());
  const costValues = byClass("dshcm-costValue");
  assert(costValues.length === 1, "expected exactly one cost value line");
  assert(textOf(costValues[0]) === `${formatCost(costNow.totalCny)} / ${formatUsd(costNow.totalUsd)}`, `cost value should be "￥X / $Y", got "${textOf(costValues[0])}"`);
  const tip = costValues[0].props.title;
  assert(typeof tip === "string" && tip.includes("deepseek-v4-pro"), "cost value tooltip should name the model");
  assert((tip.includes("现行价格") || tip.includes("高峰价") || tip.includes("空闲价")) && tip.includes("元/百万tok") && tip.includes("USD"), "cost value tooltip should carry tier + both-currency rates");

  // Empty state: no data → nothing rendered.
  const empty = detail.component({ useProjection: () => undefined, useSession: () => [] });
  assert(empty === null, "detail must render null with no data");
}

// ── multi-model session: per-model blocks + summed cost ─────────────────────
{
  const registers = [];
  const slots = {
    inject(key, cb) { cb(); },
    register(opts, component) { registers.push({ opts, component }); return () => {}; },
  };
  loaded.apply({ slots });
  const detail = registers.find((r) => r.opts.name === "conversation.context.detail").component;

  const flashBuckets = { uncachedInputTokens: 100_000, cacheReadTokens: 200_000, cacheWriteTokens: 0, outputTokens: 50_000 };
  const proBuckets = { uncachedInputTokens: 500_000, cacheReadTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 300_000 };
  const el = detail({
    useProjection: (key) => {
      if (key === "sessionStats") return { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
      if (key === "tokenUsageByModel") return { models: [
        { model: "deepseek-v4-flash", ...flashBuckets },
        { model: "deepseek-v4-pro", ...proBuckets },
      ] };
      return undefined;
    },
    useSession: () => [],
  });

  const kids = (Array.isArray(el.children) ? el.children : [el.children]).flat();
  const textOf = (node) => {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "string" || typeof node === "number") return String(node ?? "");
    const k = Array.isArray(node.children) ? node.children : [];
    return k.map(textOf).join("");
  };
  const byClass = (cls) => kids.filter((k) => k && k.props && typeof k.props.className === "string" && k.props.className.split(" ").includes(cls));
  const textOfClass = (cls) => byClass(cls).map(textOf);

  // Two model-name rows, each followed by its own bucket rows.
  const modelNames = textOfClass("dshcm-modelName");
  assert(modelNames.length === 2 && modelNames[0] === "deepseek-v4-flash" && modelNames[1] === "deepseek-v4-pro",
    `expected two model blocks, got ${JSON.stringify(modelNames)}`);
  const rows = textOfClass("dshcm-detailRow");
  assert(rows[0] === "命中 200K · 未命中 100K", `flash input row: ${rows[0]}`);            // write 0 → omitted
  assert(rows[1] === "输出 50K tok", `flash output row: ${rows[1]}`);
  assert(rows[2] === "缓存命中率 67%", `flash hit rate: ${rows[2]}`);                      // 200/(100+200) = 66.7 → 67
  assert(rows[3] === "命中 200K · 未命中 500K · 写入 100K", `pro input row: ${rows[3]}`);
  assert(rows[4] === "输出 300K tok", `pro output row: ${rows[4]}`);
  assert(rows[5] === "缓存命中率 25%", `pro hit rate: ${rows[5]}`);

  // Summed cost in both currencies.
  const now = new Date();
  const f = loaded.costOfBuckets({ uncached: flashBuckets.uncachedInputTokens, cacheRead: flashBuckets.cacheReadTokens, cacheWrite: flashBuckets.cacheWriteTokens, output: flashBuckets.outputTokens }, "deepseek-v4-flash", now);
  const p = loaded.costOfBuckets({ uncached: proBuckets.uncachedInputTokens, cacheRead: proBuckets.cacheReadTokens, cacheWrite: proBuckets.cacheWriteTokens, output: proBuckets.outputTokens }, "deepseek-v4-pro", now);
  const expectedCny = f.totalCny + p.totalCny;
  const expectedUsd = f.totalUsd + p.totalUsd;
  const costValues = byClass("dshcm-costValue");
  assert(costValues.length === 1, "expected one summed cost line");
  assert(textOf(costValues[0]) === `${formatCost(expectedCny)} / ${formatUsd(expectedUsd)}`, `summed cost wrong: ${textOf(costValues[0])}`);
  const tip = costValues[0].props.title;
  assert(tip.includes("deepseek-v4-flash") && tip.includes("deepseek-v4-pro"), "summed tooltip should name both models");
  assert(tip.includes("合计 ") && tip.includes("元/百万tok"), "summed tooltip should carry 合计 + rates");
}

// ── balance formatting helpers ──────────────────────────────────────────────
assert(currencySymbol("CNY") === "￥" && currencySymbol("USD") === "$" && currencySymbol("EUR") === "EUR ", "currencySymbol");
assert(formatAmount("110.00") === "110.00", `formatAmount("110.00") → ${formatAmount("110.00")}`);
assert(formatAmount(12345.67) === "12,345.67", `formatAmount(12345.67) → ${formatAmount(12345.67)}`);
assert(formatAmount("0") === "0.00", "formatAmount zero");
assert(formatClock(new Date("2026-08-15T14:32:00+08:00").getTime()) === "14:32", "formatClock");

// ── BalanceBlock rendering ─────────────────────────────────────────────────
{
  const el = BalanceBlock({
    state: {
      status: "ok",
      value: {
        isAvailable: true,
        balanceInfos: [
          { currency: "CNY", total: "110.00", granted: "10.00", toppedUp: "100.00" },
          { currency: "USD", total: "15.50", granted: "0.00", toppedUp: "15.50" },
        ],
      },
      fetchedAt: new Date("2026-08-15T14:32:00+08:00").getTime(),
    },
    onRefresh: () => {},
  });
  const textOf = (node) => {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "string" || typeof node === "number") return String(node ?? "");
    const k = Array.isArray(node.children) ? node.children : [];
    return k.map(textOf).join("");
  };
  const kids = (Array.isArray(el.children) ? el.children : [el.children]).flat();
  const byClass = (cls) => kids.filter((k) => k && k.props && typeof k.props.className === "string" && k.props.className.split(" ").includes(cls));
  const textOfClass = (cls) => byClass(cls).map(textOf);

  assert(el.type === "div" && el.props.className === "dshcm-balance", "balance root class");
  assert(byClass("dshcm-divider").length === 3, `balance dividers = ${byClass("dshcm-divider").length}`);
  assert(JSON.stringify(textOfClass("dshcm-detailTitle")) === JSON.stringify(["余额"]), "balance header");
  assert(JSON.stringify(textOfClass("dshcm-modelName")) === JSON.stringify(["CNY", "USD"]), "one block per currency");
  assert(JSON.stringify(textOfClass("dshcm-balanceValue")) === JSON.stringify(["￥110.00", "$15.50"]), "balance values");
  const rows = textOfClass("dshcm-detailRow");
  assert(JSON.stringify(rows) === JSON.stringify([
    "充值 ￥100.00 · 赠送 ￥10.00",
    "充值 $15.50 · 赠送 $0.00",
    "更新于 14:32 · 点击刷新",
  ]), `balance rows: ${JSON.stringify(rows)}`);
  const refreshRow = byClass("dshcm-clickable").find((r) => typeof r.props.onClick === "function");
  assert(refreshRow !== void 0, "refresh row must be clickable");
}

// ── BalanceBlock states ─────────────────────────────────────────────────────
{
  assert(BalanceBlock({ state: { status: "hidden" } }) === null, "hidden → null");
  const loading = BalanceBlock({ state: { status: "loading" }, onRefresh: () => {} });
  const textOf = (node) => {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "string" || typeof node === "number") return String(node ?? "");
    const k = Array.isArray(node.children) ? node.children : [];
    return k.map(textOf).join("");
  };
  const loadingKids = (Array.isArray(loading.children) ? loading.children : [loading.children]).flat();
  const loadingRow = loadingKids.find((k) => k && k.props && k.props.className === "dshcm-detailRow");
  assert(loadingRow && textOf(loadingRow) === "加载中…", "loading row");

  const err = BalanceBlock({ state: { status: "error", error: "HTTP 401 Unauthorized" }, onRefresh: () => {} });
  const errKids = (Array.isArray(err.children) ? err.children : [err.children]).flat();
  const errRow = errKids.find((k) => k && k.props && typeof k.props.className === "string" && k.props.className.split(" ").includes("dshcm-clickable"));
  assert(errRow && textOf(errRow) === "余额获取失败 · 点击重试", `error row: ${errRow && textOf(errRow)}`);
  assert(errRow.props.title === "HTTP 401 Unauthorized" && typeof errRow.props.onClick === "function", "error row carries message + retry");

  const unavailable = BalanceBlock({
    state: { status: "ok", value: { isAvailable: false, balanceInfos: [{ currency: "CNY", total: "0.00", granted: "0.00", toppedUp: "0.00" }] }, fetchedAt: Date.now() },
    onRefresh: () => {},
  });
  const uaKids = (Array.isArray(unavailable.children) ? unavailable.children : [unavailable.children]).flat();
  const uaText = uaKids.map(textOf).join("");
  assert(uaText.includes("⚠ 账户当前不可用"), "is_available=false must surface a warning row");
}

// ── DetailPanel with a live connection: balance section renders below 费用 ──
{
  const registers = [];
  const slots = {
    inject(key, cb) { cb(); },
    register(opts, component) { registers.push({ opts, component }); return () => {}; },
  };
  const rpcCalls = [];
  loaded.apply({
    slots,
    connection: {
      rpc: {
        call: async (channel, endpoint, payload) => {
          rpcCalls.push({ channel, endpoint });
          return { ok: true, value: { status: "ok", fetchedAt: Date.now(), isAvailable: true, balanceInfos: [{ currency: "CNY", total: "88.00", granted: "8.00", toppedUp: "80.00" }] } };
        },
      },
    },
  });
  const detail = registers.find((r) => r.opts.name === "conversation.context.detail").component;
  const el = detail({
    useProjection: (key) => {
      if (key === "sessionStats") return { turns: 3, steps: 5, llmMs: 150_000, toolMs: 20_000, ttftMs: 1_200, ttftSteps: 4, decodeMs: 30_000, decodeTokens: 1500 };
      if (key === "tokenUsage") return { uncachedInputTokens: 500_000, cacheReadTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 300_000 };
      return undefined;
    },
    useSession: () => [
      { kind: "assistant", turn: 1, step: 1, provenance: { provider: "deepseek-official", model: "deepseek-v4-pro" }, timing: null, usage: null },
    ],
  });
  const textOf = (node) => {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "string" || typeof node === "number") return String(node ?? "");
    const k = Array.isArray(node.children) ? node.children : [];
    return k.map(textOf).join("");
  };
  const collectByClass = (node, cls, out) => {
    if (Array.isArray(node)) { for (const n of node) collectByClass(n, cls, out); return; }
    if (node == null || typeof node !== "object") return;
    if (node.props && typeof node.props.className === "string" && node.props.className.split(" ").includes(cls)) out.push(node);
    const k = Array.isArray(node.children) ? node.children : [];
    for (const n of k) collectByClass(n, cls, out);
  };
  const headers = [];
  collectByClass(el, "dshcm-detailTitle", headers);
  assert(JSON.stringify(headers.map(textOf)) === JSON.stringify(["会话统计", "Token 用量", "费用", "余额"]),
    `balance must be the LAST section, got ${JSON.stringify(headers.map(textOf))}`);
  assert(textOf(el).includes("加载中…"), "balance section in loading state while the RPC settles");
  assert(rpcCalls.length === 0, "no RPC call before the effect runs (effect is stubbed in tests)");
}

console.log("ALL TESTS PASSED — dsh-cost-meter client bundle OK");
