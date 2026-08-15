/**
 * dsh-cost-meter — Host half.
 *
 * Registers the `tokenUsageByModel` session-projection unit: whole-log,
 * per-model token accounting folded from `request/header` (model) and usage
 * samples (`assistant/chunk` usage frames, `assistant/message`), so the
 * browser half can price each model the session actually used and show the
 * summed cost. The `dsh.client` declaration in package.json also makes this
 * package a client bundle in the web UI.
 */
import { tokenUsageByModelProjectionDefinition } from "./projection.js";

/** Stable Cordis plugin name. */
const name = "cost-meter";
/** The projection registry is this plugin's whole purpose. */
const inject = ["sessionProjections"];

/**
 * Register the per-model usage unit; registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
function apply(ctx) {
	ctx.sessionProjections.register(tokenUsageByModelProjectionDefinition);
}

export { apply, inject, name };
