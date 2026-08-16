/**
 * dsh-cost-meter — Host-side account-balance support.
 *
 * Implements the balance feature of the DeepSeek pricing docs' sibling page,
 * https://api-docs.deepseek.com/zh-cn/api/get-user-balance/ :
 *
 *   GET /user/balance        Authorization: Bearer <api key>
 *   → { "is_available": bool, "balance_infos": [
 *        { "currency": "CNY"|"USD", "total_balance": "110.00",
 *          "granted_balance": "10.00", "topped_up_balance": "100.00" } ] }
 *
 * The host half owns the API key (never shipped to the browser) and exposes
 * one RPC endpoint — channel `/rpc`, endpoint `cost-meter/balance` — that the
 * browser half calls when the context-ring panel opens. The API key and base
 * URL are resolved the same way `@deepseek-ai/dsh-llm-deepseek` resolves
 * them, so a custom `llm-deepseek` settings section or `$DEEPSEEK_BASE_URL`
 * carries over automatically.
 *
 * The RPC handler always answers a *successful* RPC result carrying a
 * discriminated value (the closed RpcError schema has no room for this
 * domain's failure modes):
 *
 *   { status: "ok", fetchedAt, isAvailable, balanceInfos:[{currency,total,granted,toppedUp}] }
 *   { status: "unconfigured" }                      // no API key to ask with
 *   { status: "error", message, httpStatus? }
 */

import { settingsNamespace } from "@deepseek-ai/dsh-settings";

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const PUBLIC_BASE_URL = "https://api.deepseek.com";
const BALANCE_PATH = "user/balance";
/** RPC channel + endpoint the browser half calls. */
export const BALANCE_CHANNEL = "/rpc";
export const BALANCE_ENDPOINT = "cost-meter/balance";

/**
 * Resolve the connection facts (credential ref + base URL) for the balance
 * call, mirroring dsh-llm-deepseek: an optional `llm-deepseek` settings
 * section wins, then `$DEEPSEEK_BASE_URL` from the launching environment,
 * then the public API.
 * @param ctx - host context (may lack the settings service).
 * @param env - environment map (defaults to process.env).
 * @returns {apiKeyEnv, baseURL}.
 */
export function resolveConnectionFacts(ctx, env = process.env) {
	let apiKeyEnv = DEFAULT_API_KEY_ENV;
	let baseURL = (typeof env.DEEPSEEK_BASE_URL === "string" && env.DEEPSEEK_BASE_URL.length > 0)
		? env.DEEPSEEK_BASE_URL
		: PUBLIC_BASE_URL;
	const settings = ctx && typeof ctx.get === "function" ? ctx.get("settings") : undefined;
	if (settings && typeof settings.get === "function") {
		try {
			const section = settings.get(settingsNamespace("llm-deepseek"));
			if (section && typeof section === "object") {
				if (typeof section.apiKeyEnv === "string" && section.apiKeyEnv.length > 0) apiKeyEnv = section.apiKeyEnv;
				if (typeof section.baseURL === "string" && section.baseURL.length > 0) baseURL = section.baseURL;
			}
		} catch {
			// namespace not registered → defaults stay.
		}
	}
	return { apiKeyEnv, baseURL };
}

/**
 * Resolve the API key through the credential seam, falling back to the
 * launching environment — the same two sources dsh-llm-deepseek consults.
 * @param ctx - host context (may lack the credentials service).
 * @param apiKeyEnv - credential reference to resolve.
 * @param env - environment map (defaults to process.env).
 * @returns the non-empty secret, or undefined when unconfigured.
 */
export async function resolveApiKey(ctx, apiKeyEnv, env = process.env) {
	const credentials = ctx && typeof ctx.get === "function" ? ctx.get("credentials") : undefined;
	if (credentials && typeof credentials.resolve === "function") {
		const hit = await credentials.resolve(apiKeyEnv);
		if (hit && typeof hit.value === "string" && hit.value.length > 0) return hit.value;
	}
	const ambient = env[apiKeyEnv];
	if (typeof ambient === "string" && ambient.length > 0) return ambient;
	return undefined;
}

/**
 * Normalize the documented `/user/balance` payload into the plugin's value
 * shape. Throws on a malformed response (the caller folds it into
 * `{status:"error"}`).
 * @param json - parsed response body.
 * @returns {isAvailable, balanceInfos}.
 */
export function normalizeBalance(json) {
	if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("响应不是 JSON 对象");
	if (typeof json.is_available !== "boolean") throw new Error("缺少 is_available 字段");
	if (!Array.isArray(json.balance_infos)) throw new Error("缺少 balance_infos 字段");
	const balanceInfos = json.balance_infos.map((info, index) => {
		if (info === null || typeof info !== "object") throw new Error(`balance_infos[${index}] 不是对象`);
		const read = (name) => {
			const value = info[name];
			return typeof value === "string" ? value : String(value ?? "");
		};
		return {
			currency: read("currency"),
			total: read("total_balance"),
			granted: read("granted_balance"),
			toppedUp: read("topped_up_balance")
		};
	});
	return { isAvailable: json.is_available, balanceInfos };
}

/**
 * One balance query, fully folded into the plugin's value contract. Never
 * throws for API/HTTP/parse failures — it reports them as `{status:"error"}`.
 * @param ctx - host context (settings/credentials resolution).
 * @param signal - abort signal from the RPC caller.
 * @param env - environment map (defaults to process.env).
 * @param fetchImpl - fetch implementation (defaults to the global one).
 * @returns the discriminated balance value.
 */
export async function fetchBalance(ctx, signal, env = process.env, fetchImpl = globalThis.fetch) {
	const { apiKeyEnv, baseURL } = resolveConnectionFacts(ctx, env);
	const apiKey = await resolveApiKey(ctx, apiKeyEnv, env);
	if (apiKey === undefined) return { status: "unconfigured", apiKeyEnv };
	const url = `${baseURL.replace(/\/+$/, "")}/${BALANCE_PATH}`;
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
			signal
		});
	} catch (error) {
		return { status: "error", message: error instanceof Error ? error.message : String(error) };
	}
	if (!response.ok) {
		const statusText = typeof response.statusText === "string" && response.statusText.length > 0 ? ` ${response.statusText}` : "";
		return { status: "error", message: `HTTP ${response.status}${statusText}`, httpStatus: response.status };
	}
	let json;
	try {
		json = await response.json();
	} catch {
		return { status: "error", message: "余额响应不是有效 JSON" };
	}
	try {
		const normalized = normalizeBalance(json);
		return { status: "ok", fetchedAt: Date.now(), ...normalized };
	} catch (error) {
		return { status: "error", message: `余额响应格式异常: ${error.message}` };
	}
}

/**
 * Register the balance endpoint on the generic Connection RPC channel the
 * browser half calls. Registration rides the calling fiber (auto-disposed).
 * @param ctx - host context with the `connection` service injected.
 * @returns the channel disposer, or undefined when the service is absent.
 */
export function registerBalanceRpc(ctx) {
	const connection = ctx && typeof ctx.get === "function" ? ctx.get("connection") : undefined;
	if (!connection || !connection.rpc || typeof connection.rpc.handle !== "function") return undefined;
	const handler = async (endpoint, payload, signal) => {
		if (endpoint !== BALANCE_ENDPOINT) {
			return {
				ok: false,
				error: {
					code: "bad-request",
					message: `未知端点 ${JSON.stringify(endpoint)}`,
					details: { issues: [] }
				}
			};
		}
		try {
			const value = await fetchBalance(ctx, signal);
			return { ok: true, value };
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
	};
	return connection.rpc.handle(BALANCE_CHANNEL, handler, { authority: "loopback" });
}
