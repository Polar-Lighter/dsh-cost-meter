/**
 * dsh-cost-meter — Browser half (hand-built client bundle).
 *
 * Hides the composer's bottom status bar, and shows the session figures
 * (turns/steps, durations, throughput, per-bucket tokens, cache-hit rate and
 * the CNY cost with model/tier/rates) INSIDE the context-meter ring's
 * click-open panel (the `conversation.context.detail` slot the patched
 * ui-conversation bundle renders inside the panel). Nothing is shown in the
 * foreground persistently — the ring itself stays as the app renders it, and
 * its panel now also carries the session detail.
 *
 * Requires the companion bundle patch (see tools/apply-bundle-patches.ps1):
 * ui-conversation's ContextMeter receives `renderSlot` from InputBar and
 * renders `renderSlot("conversation.context.detail", {})` inside its panel,
 * with the child slot declared by InputBar's registration.
 *
 * Pricing follows the official page
 * (https://api-docs.deepseek.com/zh-cn/quick_start/pricing): flat prices now,
 * peak/off-peak from 2026-08-17 00:00 Beijing time.
 *
 * Bundle contract: lazy CJS — `window.__ModuleLoader__.load({ id, factory })`,
 * factory receives the synchronous module-table `require`.
 */
window.__ModuleLoader__.load({
	id: "dsh-cost-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ─────────────────────────────────────────────────────────────────────
		// DeepSeek pricing — ¥ / $ per 1,000,000 tokens (1M tokens).
		// SOURCE: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
		// (official tables, verified 2026-08-15; both currencies).
		//
		// Regime 1 — 现行价格 (until 2026-08-17 00:00 Beijing time):
		//   deepseek-v4-flash: 输入(命中) 0.02元/$0.0028 · 输入(未命中) 1元/$0.14 · 输出 2元/$0.28
		//   deepseek-v4-pro:   输入(命中) 0.025元/$0.003625 · 输入(未命中) 3元/$0.435 · 输出 6元/$0.87
		//
		// Regime 2 — 峰谷定价 (from 2026-08-17 00:00 Beijing / 16:00 UTC Aug 16;
		// off-peak = half of peak). Peak = Beijing 9:00–12:00, 14:00–18:00
		// (= UTC 01:00–04:00, 06:00–10:00):
		//   deepseek-v4-flash 空闲: 0.05/1.5/4.5元 · 0.007/0.22/0.66$
		//                    高峰: 0.10/3.0/9.0元 · 0.014/0.44/1.32$
		//   deepseek-v4-pro   空闲: 0.15/4.5/13.5元 · 0.022/0.66/1.98$
		//                    高峰: 0.30/9.0/27.0元 · 0.044/1.32/3.96$
		//
		// Billing: cache-write tokens at the cache-miss (uncached) input rate;
		// cache-read at the cache-hit rate; reasoning tokens are inside output.
		// The meter prices the whole log at the rate in effect right now
		// (peak/off-peak follows the current Beijing time) — the `tokenUsage`
		// projection is cumulative and carries no per-request timestamps.
		// ─────────────────────────────────────────────────────────────────────
		var PRICE_REGIMES = {
			"deepseek-v4-flash": {
				flat: {
					cny: { inputHit: 0.02, inputMiss: 1.0, output: 2.0 },
					usd: { inputHit: 0.0028, inputMiss: 0.14, output: 0.28 }
				},
				offpeak: {
					cny: { inputHit: 0.05, inputMiss: 1.5, output: 4.5 },
					usd: { inputHit: 0.007, inputMiss: 0.22, output: 0.66 }
				},
				peak: {
					cny: { inputHit: 0.10, inputMiss: 3.0, output: 9.0 },
					usd: { inputHit: 0.014, inputMiss: 0.44, output: 1.32 }
				}
			},
			"deepseek-v4-pro": {
				flat: {
					cny: { inputHit: 0.025, inputMiss: 3.0, output: 6.0 },
					usd: { inputHit: 0.003625, inputMiss: 0.435, output: 0.87 }
				},
				offpeak: {
					cny: { inputHit: 0.15, inputMiss: 4.5, output: 13.5 },
					usd: { inputHit: 0.022, inputMiss: 0.66, output: 1.98 }
				},
				peak: {
					cny: { inputHit: 0.30, inputMiss: 9.0, output: 27.0 },
					usd: { inputHit: 0.044, inputMiss: 1.32, output: 3.96 }
				}
			}
		};
		/** Model used when the conversation window carries no provenance yet. */
		var DEFAULT_MODEL = "deepseek-v4-flash";
		/** Peak/off-peak pricing takes effect at 2026-08-17 00:00 Beijing (UTC+8). */
		var PEAK_OFFPEAK_START_UTC = Date.UTC(2026, 7, 16, 16, 0, 0); // = 2026-08-16T16:00Z

		// ── pricing helpers ──────────────────────────────────────────────────
		/** Beijing-time peak windows: 9:00–12:00 and 14:00–18:00 (start-inclusive, end-exclusive). */
		function isBeijingPeak(now) {
			var beijing = new Date(now.getTime() + 8 * 3600 * 1000);
			var minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
			return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
		}

		/**
		 * Resolve the price tier + rates for a model at a given moment.
		 * @param model - model id.
		 * @param now - evaluation time (Date).
		 * @returns {model, tier, price} — tier is "flat" | "peak" | "offpeak".
		 */
		function priceOf(model, now) {
			var resolvedModel = PRICE_REGIMES[model] ? model : DEFAULT_MODEL;
			var table = PRICE_REGIMES[resolvedModel];
			if (now.getTime() < PEAK_OFFPEAK_START_UTC) {
				return { model: resolvedModel, tier: "flat", price: table.flat };
			}
			var tier = isBeijingPeak(now) ? "peak" : "offpeak";
			return { model: resolvedModel, tier, price: table[tier] };
		}

		// ── cost math ────────────────────────────────────────────────────────
		/**
		 * Session cost from the durable token-usage projection, in both CNY and
		 * USD (the official table prices both currencies).
		 * @param usage - the `tokenUsage` projection value (may be undefined).
		 * @param model - model id for the price tier.
		 * @param now - evaluation time (defaults to the current moment).
		 * @returns {total, totalCny, totalUsd, model, tier, price, usage} or null
		 *          when nothing was billed.
		 */
		/**
		 * Cost of ONE model's token buckets in both CNY and USD.
		 * @param buckets - {uncached, cacheRead, cacheWrite, output} tokens.
		 * @param model - model id for the price tier.
		 * @param now - evaluation time (defaults to the current moment).
		 * @returns {total, totalCny, totalUsd, model, tier, price} or null when
		 *          nothing was billed.
		 */
		function costOfBuckets(buckets, model, now) {
			if (!buckets || typeof buckets !== "object") return null;
			var uncached = buckets.uncached || 0;
			var cacheRead = buckets.cacheRead || 0;
			var cacheWrite = buckets.cacheWrite || 0;
			var output = buckets.output || 0;
			if (uncached + cacheRead + cacheWrite + output <= 0) return null;
			var resolved = priceOf(model || DEFAULT_MODEL, now || new Date());
			var billedInput = uncached + cacheWrite;
			var totalCny =
				(billedInput * resolved.price.cny.inputMiss +
					cacheRead * resolved.price.cny.inputHit +
					output * resolved.price.cny.output) / 1e6;
			var totalUsd =
				(billedInput * resolved.price.usd.inputMiss +
					cacheRead * resolved.price.usd.inputHit +
					output * resolved.price.usd.output) / 1e6;
			return {
				total: totalCny,
				totalCny,
				totalUsd,
				model: resolved.model,
				tier: resolved.tier,
				price: resolved.price
			};
		}

		/**
		 * Session cost from the durable model-agnostic `tokenUsage` projection
		 * (single-model view; multi-model sessions use costOfBuckets per model).
		 * @param usage - the `tokenUsage` projection value (may be undefined).
		 * @param model - model id for the price tier.
		 * @param now - evaluation time (defaults to the current moment).
		 * @returns {total, totalCny, totalUsd, model, tier, price} or null when
		 *          nothing was billed.
		 */
		function costOf(usage, model, now) {
			if (!usage || typeof usage !== "object") return null;
			return costOfBuckets({
				uncached: usage.uncachedInputTokens || 0,
				cacheRead: usage.cacheReadTokens || 0,
				cacheWrite: usage.cacheWriteTokens || 0,
				output: usage.outputTokens || 0
			}, model, now);
		}

		/** Compact CNY amount: ￥0 / ￥0.0032 / ￥1.23 / ￥12.5 — never false zeros. */
		function formatCost(c) {
			if (c <= 0) return "￥0";
			if (c < 0.0001) return "￥<0.0001";
			var s = c.toFixed(4).replace(/\.?0+$/, "");
			return "￥" + s;
		}

		/** Compact USD amount: $ 0 / $ 0.0032 / $ 1.23 — never false zeros. */
		function formatUsd(c) {
			if (c <= 0) return "$ 0";
			if (c < 0.0001) return "$ <0.0001";
			var s = c.toFixed(4).replace(/\.?0+$/, "");
			return "$ " + s;
		}

		/** Human-readable pricing-tier label. */
		function tierLabel(tier) {
			return tier === "flat" ? "现行价格" : tier === "peak" ? "高峰价" : "空闲价";
		}

		// ── stats fold helpers (mirror ui-conversation's StatsLine math) ──────
		/** Read one assistant node's TTFT, decode wall time, and output tokens. */
		function assistantStepReading(node) {
			var timing = node.timing;
			return {
				ttftMs: timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
				decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
				outputTokens: usageOutputTokens(node.usage)
			};
		}

		function usageOutputTokens(usage) {
			if (typeof usage !== "object" || usage === null) return null;
			var value = usage.outputTokens;
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		}

		/**
		 * Window-scope fallback fold (used when the `sessionStats` projection is
		 * absent) — same field names as the projection so the two swap wholesale.
		 * @param nodes - snapshot nodes of the loaded window.
		 */
		function deriveStats(nodes) {
			var turns = /* @__PURE__ */ new Set();
			var steps = 0;
			var llmMs = 0;
			var toolMs = 0;
			var ttftMs = 0;
			var ttftSteps = 0;
			var decodeMs = 0;
			var decodeTokens = 0;
			for (var i = 0; i < nodes.length; i++) {
				var node = nodes[i];
				if (node.kind === "tool-result") {
					if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
					continue;
				}
				if (node.kind !== "assistant") continue;
				turns.add(node.turn);
				steps += 1;
				if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
				var reading = assistantStepReading(node);
				if (reading.ttftMs !== null) {
					ttftMs += reading.ttftMs;
					ttftSteps += 1;
				}
				if (reading.decodeMs !== null && reading.outputTokens !== null) {
					decodeMs += reading.decodeMs;
					decodeTokens += reading.outputTokens;
				}
			}
			return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens };
		}

		/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
		function formatTokens(n) {
			var scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
			if (n < 1e3) return String(n);
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}

		/** Compact duration: 45.2s under a minute, 2m42s from there on. */
		function formatDuration(ms) {
			var s = ms / 1e3;
			if (s < 60) return Math.round(s * 10) / 10 + "s";
			var whole = Math.round(s);
			return Math.floor(whole / 60) + "m" + whole % 60 + "s";
		}

		/** Decode-throughput figure: whole tokens from ten up, one decimal below. */
		function formatTokensPerSecond(tps) {
			var clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}

		/** Sum the three disjoint prompt-side billing buckets. */
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
		}

		/** Cache-hit share of prompt-side input, rounded percent or null. */
		function cacheHitPercent(usage) {
			var denominator = billedInputTokens(usage);
			return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100);
		}

		// ── the session-detail block inside the context ring's panel ─────────
		/**
		 * Rendered inside the context-meter panel (the patched
		 * `conversation.context.detail` slot): 会话统计 / Token 用量 / 费用
		 * sections, styled to match the panel.
		 */
		function DetailPanel(props) {
			var useProjection = props.useProjection;
			var useSession = props.useSession;
			var nodes = useSession(function (s) { return s.chat.legacy.nodes; });
			var usage = useProjection("tokenUsage");
			var byModel = useProjection("tokenUsageByModel");
			var projected = useProjection("sessionStats");
			var stats = react.useMemo(function () {
				return projected !== void 0 ? projected : deriveStats(Array.isArray(nodes) ? nodes : []);
			}, [projected, nodes]);

			// Model of the last finalized assistant message (fallback + single-model view).
			var lastModel = DEFAULT_MODEL;
			if (Array.isArray(nodes)) {
				for (var i = nodes.length - 1; i >= 0; i--) {
					var node = nodes[i];
					if (node && node.kind === "assistant" && node.provenance && node.provenance.model) {
						lastModel = node.provenance.model;
						break;
					}
				}
			}

			// Per-model token buckets: prefer the whole-log per-model projection
			// (a session may use several models); fall back to the model-agnostic
			// projection attributed to the last-used model.
			var modelEntries = [];
			if (byModel !== void 0 && byModel !== null && Array.isArray(byModel.models) && byModel.models.length > 0) {
				for (var mi = 0; mi < byModel.models.length; mi++) {
					var m = byModel.models[mi];
					modelEntries.push({
						model: m.model,
						buckets: {
							uncached: m.uncachedInputTokens,
							cacheRead: m.cacheReadTokens,
							cacheWrite: m.cacheWriteTokens,
							output: m.outputTokens
						}
					});
				}
			} else if (usage !== void 0 && usage !== null && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				modelEntries.push({
					model: lastModel,
					buckets: {
						uncached: usage.uncachedInputTokens,
						cacheRead: usage.cacheReadTokens,
						cacheWrite: usage.cacheWriteTokens,
						output: usage.outputTokens
					}
				});
			}

			// Per-model costs and the grand total (both currencies).
			var now = new Date();
			var costs = [];
			var totalCny = 0;
			var totalUsd = 0;
			for (var ci = 0; ci < modelEntries.length; ci++) {
				var c = costOfBuckets(modelEntries[ci].buckets, modelEntries[ci].model, now);
				if (c === null) continue;
				costs.push(c);
				totalCny += c.totalCny;
				totalUsd += c.totalUsd;
			}

			var hasSteps = stats.steps > 0;
			var hasTokens = modelEntries.length > 0;
			var hasCost = costs.length > 0;
			if (!hasSteps && !hasTokens && !hasCost) return null;

			var divider = function () {
				return react.createElement("div", { className: "dshcm-divider" });
			};
			var header = function (children) {
				return react.createElement("div", { className: "dshcm-detailTitle" }, children);
			};
			var row = function (children) {
				return react.createElement("div", { className: "dshcm-detailRow" }, children);
			};

			// Template: each section is [divider, header, divider, content…].
			var children = [];
			if (hasSteps) {
				children.push(divider());
				children.push(header("会话统计"));
				children.push(divider());
				children.push(row(stats.turns + " 轮 · " + stats.steps + " 步"));
				var durations = [];
				if (stats.llmMs > 0) durations.push("LLM " + formatDuration(stats.llmMs));
				if (stats.toolMs > 0) durations.push("工具调用 " + formatDuration(stats.toolMs));
				if (durations.length > 0) children.push(row(durations.join(" · ")));
				var speeds = [];
				if (stats.ttftSteps > 0) speeds.push("首 token 平均 " + formatDuration(stats.ttftMs / stats.ttftSteps));
				if (stats.decodeMs > 0) speeds.push(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) + " tok/s");
				if (speeds.length > 0) children.push(row(speeds.join(" · ")));
			}
			if (hasTokens) {
				children.push(divider());
				children.push(header("Token 用量"));
				children.push(divider());
				// One block per model actually used; the model name heads each block.
				for (var bi = 0; bi < modelEntries.length; bi++) {
					var entry = modelEntries[bi];
					var b = entry.buckets;
					children.push(react.createElement("div", {
						className: "dshcm-modelName" + (bi > 0 ? " dshcm-modelNameSpaced" : "")
					}, entry.model));
					var inputLine = "命中 " + formatTokens(b.cacheRead) + " · 未命中 " + formatTokens(b.uncached);
					if (b.cacheWrite > 0) inputLine += " · 写入 " + formatTokens(b.cacheWrite);
					children.push(row(inputLine));
					children.push(row("输出 " + formatTokens(b.output) + " tok"));
					var denom = b.uncached + b.cacheRead + b.cacheWrite;
					var pct = denom === 0 ? null : Math.round(b.cacheRead / denom * 100);
					if (pct !== null) children.push(row("缓存命中率 " + pct + "%"));
				}
			}
			if (hasCost) {
				children.push(divider());
				children.push(header("费用"));
				children.push(divider());
				// Hover detail: per-model costs with their rates, grand total, tier.
				var tipParts = [];
				for (var tj = 0; tj < costs.length; tj++) {
					var cc = costs[tj];
					tipParts.push(cc.model + " " + formatCost(cc.totalCny) + " / " + formatUsd(cc.totalUsd) +
						"（元/百万tok 未命中 " + cc.price.cny.inputMiss + " · 命中 " + cc.price.cny.inputHit + " · 输出 " + cc.price.cny.output +
						"；USD 未命中 " + cc.price.usd.inputMiss + " · 命中 " + cc.price.usd.inputHit + " · 输出 " + cc.price.usd.output + "）");
				}
				tipParts.push("合计 " + formatCost(totalCny) + " / " + formatUsd(totalUsd));
				tipParts.push(tierLabel(costs[0].tier));
				children.push(react.createElement("div", {
					className: "dshcm-costValue",
					title: tipParts.join(" · ")
				}, formatCost(totalCny) + " / " + formatUsd(totalUsd)));
				children.push(divider());
			}

			return react.createElement("div", { className: "dshcm-detail" }, children);
		}

		/** Shadow entry: renders nothing, hiding the built-in bottom status bar. */
		function HiddenDock() {
			return null;
		}

		// ── stylesheet ────────────────────────────────────────────────────────
		// Detail block inside the context panel: inherits the panel's 12px
		// typography; separated from the context breakdown by a hairline.
		var CSS_ID = "dsh-cost-meter/statusbar";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]") === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cost-meter";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".dshcm-detail{font-size:12px;line-height:20px}",
				".dshcm-divider{border-top:1px solid var(--dsw-alias-border-l1);margin:4px 0}",
				".dshcm-detailTitle{color:var(--dsw-alias-label-tertiary);font-weight:700;margin:2px 0}",
				".dshcm-detailRow{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
				".dshcm-modelName{color:var(--dsw-alias-label-secondary);font-weight:600;font-variant-numeric:tabular-nums}",
				".dshcm-modelNameSpaced{margin-top:6px}",
				".dshcm-costValue{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;margin:2px 0}"
			].join("\n");
			document.head.appendChild(tag);
		}

		// ── cordis plugin face ────────────────────────────────────────────────
		/** Services required by the browser half. */
		var inject = ["slots"];
		/**
		 * 1) Hide the built-in bottom status bar (shadow the "stats" cell).
		 * 2) Fill the context ring's panel with the session detail.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", function () {
				return ctx.slots.register({
					name: "conversation.composer.dock",
					id: "stats",
					priority: -1
				}, HiddenDock);
			});
			ctx.slots.inject("conversation.context.detail", function () {
				return ctx.slots.register({
					name: "conversation.context.detail"
				}, DetailPanel);
			});
		}

		exports.PEAK_OFFPEAK_START_UTC = PEAK_OFFPEAK_START_UTC;
		exports.apply = apply;
		exports.costOf = costOf;
		exports.costOfBuckets = costOfBuckets;
		exports.deriveStats = deriveStats;
		exports.formatCost = formatCost;
		exports.formatTokens = formatTokens;
		exports.formatUsd = formatUsd;
		exports.inject = inject;
		exports.isBeijingPeak = isBeijingPeak;
		exports.priceOf = priceOf;
		return module.exports;
	}
});
