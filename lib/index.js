/**
 * dsh-cost-meter — Host half.
 *
 * 1) Registers the `tokenUsageByModel` session-projection unit: whole-log,
 *    per-model token accounting folded from `request/header` (model) and usage
 *    samples (`assistant/chunk` usage frames, `assistant/message`), so the
 *    browser half can price each model the session actually used and show the
 *    summed cost.
 * 2) Registers the `/rpc` → `cost-meter/balance` endpoint that fetches the
 *    account balance from GET /user/balance (the API key never leaves the
 *    host).
 *
 * The `dsh.client` declaration in package.json also makes this package a
 * client bundle in the web UI.
 */
import { tokenUsageByModelProjectionDefinition } from "./projection.js";
import { registerBalanceRpc } from "./balance.js";

/** Stable Cordis plugin name. */
const name = "cost-meter";
/** Services required by this plugin. */
const inject = ["sessionProjections", "connection"];

/**
 * Register the per-model usage unit and the balance RPC channel; both are
 * effects on this plugin's fiber, so unloading removes them.
 * @param ctx - registrant context carrying the projection registry + connection.
 */
function apply(ctx) {
	ctx.sessionProjections.register(tokenUsageByModelProjectionDefinition);
	registerBalanceRpc(ctx);
}

export { apply, inject, name };
