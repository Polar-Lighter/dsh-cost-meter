/**
 * tokenUsageByModel — pure session-projection unit (host side).
 *
 * Folds the whole durable session log into per-model token buckets, so a
 * session that used several models reports each one's uncached input,
 * cache-read, cache-write, and output tokens separately. The model for each
 * usage sample is taken from the enclosing `request/header` event
 * (`header.config.model`); usage samples come from `assistant/chunk` usage
 * frames and finalized `assistant/message` records. A repeated sample for
 * the same turn/step replaces the earlier one instead of double counting
 * (the same invariant the token-meter relies on).
 *
 * Mirrors the `tokenUsage` fold's contract: state is plain JSON, `apply` is
 * synchronous and returns the same state reference for uninteresting events.
 */
import { z } from "zod";

const zeroBuckets = () => ({
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
});

/** Disjoint provider buckets from a TokenUsage record. */
function bucketsFrom(usage) {
	return {
		uncachedInputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0
	};
}

function bucketsEqual(left, right) {
	return left.uncachedInputTokens === right.uncachedInputTokens &&
		left.outputTokens === right.outputTokens &&
		left.cacheReadTokens === right.cacheReadTokens &&
		left.cacheWriteTokens === right.cacheWriteTokens;
}

function bucketsAdd(left, right) {
	return {
		uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens
	};
}

function bucketsSub(left, right) {
	return {
		uncachedInputTokens: left.uncachedInputTokens - right.uncachedInputTokens,
		outputTokens: left.outputTokens - right.outputTokens,
		cacheReadTokens: left.cacheReadTokens - right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens - right.cacheWriteTokens
	};
}

function bucketsEmpty(buckets) {
	return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens === 0;
}

const perModelSchema = z.object({
	model: z.string(),
	uncachedInputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative()
}).strict();

const schema = z.object({
	models: z.array(perModelSchema)
}).strict();

export const tokenUsageByModelProjectionDefinition = {
	key: "tokenUsageByModel",
	schema,
	init: () => ({
		byModel: {},
		last: null,
		currentModel: null
	}),
	apply: (state, event) => {
		let next = state;
		if (event.type === "request/header") {
			const model = event.data.header?.config?.model;
			if (typeof model === "string" && model !== state.currentModel) next = { ...next, currentModel: model };
		}
		let turn;
		let step;
		let usage;
		if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") {
			({ turn, step } = event.data);
			usage = event.data.chunk.usage;
		} else if (event.type === "assistant/message" && event.data.usage !== void 0) {
			({ turn, step, usage } = event.data);
		} else {
			return next;
		}
		const model = next.currentModel;
		if (model === null) return next;
		const buckets = bucketsFrom(usage);
		const previous = next.last !== null && next.last.turn === turn && next.last.step === step ? next.last : null;
		if (previous !== null && previous.model === model && bucketsEqual(previous.buckets, buckets)) return next;
		const byModel = { ...next.byModel };
		if (previous !== null) {
			const prev = byModel[previous.model];
			if (prev !== void 0) {
				const reduced = bucketsSub(prev, previous.buckets);
				if (bucketsEmpty(reduced)) delete byModel[previous.model];
				else byModel[previous.model] = reduced;
			}
		}
		byModel[model] = bucketsAdd(byModel[model] ?? zeroBuckets(), buckets);
		return { ...next, byModel, last: { turn, step, model, buckets } };
	},
	view: (state) => ({
		models: Object.entries(state.byModel)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([model, buckets]) => ({ model, ...buckets }))
	}),
	stateVersion: 1
};
