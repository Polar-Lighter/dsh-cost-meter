// Node-side test for the host balance module (lib/balance.js):
// connection-fact resolution, API-key resolution, response normalization,
// the full fetch fold (injected fetch), and the RPC channel registration.
// Loads the module from the INSTALLED profile copy so its @deepseek-ai
// imports (dsh-settings) resolve from the profile node_modules.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const req = createRequire("C:/Users/Lenovo/.dsh/profiles/web/x.js");
const pkgDir = dirname(req.resolve("dsh-cost-meter/package.json"));
const mod = await import(pathToFileURL(join(pkgDir, "lib", "balance.js")));
const { resolveConnectionFacts, resolveApiKey, normalizeBalance, fetchBalance, registerBalanceRpc } = mod;

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };

// A context whose get() serves only the services we fake.
const fakeCtx = (services) => ({ get: (name) => services[name] });
const noServices = () => fakeCtx({});
const fakeSettings = (section) => ({ get: () => section });
const fakeCredentials = (value) => ({ resolve: async (ref) => (value === undefined ? undefined : { value, source: "test" }) });
const fakeFetch = (handler) => async (url, init) => handler(url, init);

// ── resolveConnectionFacts ──────────────────────────────────────────────────
{
  const defaults = resolveConnectionFacts(noServices(), {});
  assert(defaults.apiKeyEnv === "DEEPSEEK_API_KEY" && defaults.baseURL === "https://api.deepseek.com", `defaults: ${JSON.stringify(defaults)}`);
  const envBase = resolveConnectionFacts(noServices(), { DEEPSEEK_BASE_URL: "https://gateway.example.com" });
  assert(envBase.baseURL === "https://gateway.example.com", "env DEEPSEEK_BASE_URL wins over public");
  const settingsBase = resolveConnectionFacts(fakeCtx({ settings: fakeSettings({ apiKeyEnv: "MY_DS_KEY", baseURL: "https://my.api/v1/" }) }), {});
  assert(settingsBase.apiKeyEnv === "MY_DS_KEY" && settingsBase.baseURL === "https://my.api/v1/", "settings section wins over env");
  const throwingSettings = resolveConnectionFacts(fakeCtx({ settings: { get: () => { throw new Error("not registered"); } } }), {});
  assert(throwingSettings.apiKeyEnv === "DEEPSEEK_API_KEY", "settings throw → defaults");
}

// ── resolveApiKey ───────────────────────────────────────────────────────────
{
  const viaCredentials = await resolveApiKey(fakeCtx({ credentials: fakeCredentials("sk-test") }), "DEEPSEEK_API_KEY", {});
  assert(viaCredentials === "sk-test", "credentials seam resolves the key");
  const viaEnv = await resolveApiKey(noServices(), "DEEPSEEK_API_KEY", { DEEPSEEK_API_KEY: "sk-env" });
  assert(viaEnv === "sk-env", "env fallback resolves the key");
  const none = await resolveApiKey(noServices(), "DEEPSEEK_API_KEY", {});
  assert(none === undefined, "no key anywhere → undefined");
  const emptyStored = await resolveApiKey(fakeCtx({ credentials: fakeCredentials("") }), "DEEPSEEK_API_KEY", {});
  assert(emptyStored === undefined, "empty stored value treated as absent");
}

// ── normalizeBalance ───────────────────────────────────────────────────────
{
  const ok = normalizeBalance({
    is_available: true,
    balance_infos: [
      { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
      { currency: "USD", total_balance: "15.50", granted_balance: "0.00", topped_up_balance: "15.50" },
    ],
  });
  assert(ok.isAvailable === true && ok.balanceInfos.length === 2, "normalizes the documented payload");
  assert(ok.balanceInfos[0].currency === "CNY" && ok.balanceInfos[0].total === "110.00" && ok.balanceInfos[0].granted === "10.00" && ok.balanceInfos[0].toppedUp === "100.00", "CNY entry fields");
  let threw = false;
  try { normalizeBalance({ is_available: "yes", balance_infos: [] }); } catch { threw = true; }
  assert(threw, "non-boolean is_available must throw");
  threw = false;
  try { normalizeBalance({ is_available: true }); } catch { threw = true; }
  assert(threw, "missing balance_infos must throw");
  threw = false;
  try { normalizeBalance(null); } catch { threw = true; }
  assert(threw, "null payload must throw");
}

// ── fetchBalance (injected fetch) ───────────────────────────────────────────
{
  // unconfigured
  const unconfigured = await fetchBalance(noServices(), undefined, {}, fakeFetch(() => { throw new Error("must not be called"); }));
  assert(unconfigured.status === "unconfigured", "no key → unconfigured");

  const ctx = fakeCtx({ credentials: fakeCredentials("sk-test") });

  // success
  const ok = await fetchBalance(ctx, undefined, {}, fakeFetch(async (url, init) => {
    assert(url === "https://api.deepseek.com/user/balance", `url: ${url}`);
    assert(init.headers.authorization === "Bearer sk-test", "Bearer header");
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] }) };
  }));
  assert(ok.status === "ok" && ok.isAvailable === true && ok.balanceInfos[0].total === "110.00" && typeof ok.fetchedAt === "number", "success fold");

  // trailing slash on baseURL
  const slash = await fetchBalance(fakeCtx({ credentials: fakeCredentials("sk-test"), settings: fakeSettings({ baseURL: "https://api.deepseek.com/" }) }), undefined, {}, fakeFetch(async (url) => {
    assert(url === "https://api.deepseek.com/user/balance", `slash url: ${url}`);
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ is_available: true, balance_infos: [] }) };
  }));
  assert(slash.status === "ok", "trailing slash tolerated");

  // HTTP error
  const http = await fetchBalance(ctx, undefined, {}, fakeFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) })));
  assert(http.status === "error" && http.httpStatus === 401 && http.message.includes("401"), `http error: ${JSON.stringify(http)}`);

  // transport failure
  const net = await fetchBalance(ctx, undefined, {}, fakeFetch(async () => { throw new Error("ECONNREFUSED"); }));
  assert(net.status === "error" && net.message.includes("ECONNREFUSED"), "transport failure folded");

  // malformed JSON body
  const bad = await fetchBalance(ctx, undefined, {}, fakeFetch(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => { throw new Error("bad json"); } })));
  assert(bad.status === "error", "bad json folded");

  // malformed payload
  const malformed = await fetchBalance(ctx, undefined, {}, fakeFetch(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ nope: true }) })));
  assert(malformed.status === "error" && malformed.message.includes("格式异常"), `malformed: ${malformed.message}`);
}

// ── registerBalanceRpc ──────────────────────────────────────────────────────
{
  assert(registerBalanceRpc(noServices()) === undefined, "no connection → undefined");

  let registered = null;
  const fakeConnection = { rpc: { handle: (channel, handler, options) => { registered = { channel, handler, options }; return () => {}; } } };
  const disposer = registerBalanceRpc(fakeCtx({ connection: fakeConnection, credentials: fakeCredentials("sk-test") }));
  assert(typeof disposer === "function", "returns the channel disposer");
  assert(registered.channel === "/rpc" && registered.options.authority === "loopback", "channel /rpc with loopback authority");

  const { handler } = registered;
  // The handler path uses the real global fetch — stub it for the call.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] }) });
  try {
    const okResult = await handler("cost-meter/balance", {}, undefined);
    assert(okResult.ok === true && okResult.value.status === "ok" && okResult.value.balanceInfos[0].total === "110.00", "known endpoint → ok result");
  } finally {
    globalThis.fetch = realFetch;
  }
  const badResult = await handler("other/endpoint", {}, undefined);
  assert(badResult.ok === false && badResult.error.code === "bad-request", "unknown endpoint → bad-request");

  // handler failure (credential resolve rejects) → internal error result, never a throw
  const failing = registerBalanceRpc(fakeCtx({ connection: fakeConnection, credentials: { resolve: async () => { throw new Error("boom"); } } }));
  assert(typeof failing === "function", "registration still works");
  const { handler: failingHandler } = registered;
  const errResult = await failingHandler("cost-meter/balance", {}, undefined);
  assert(errResult.ok === false && errResult.error.code === "internal" && errResult.error.message.includes("boom"), "resolve failure → internal error result");
}

console.log("ALL TESTS PASSED — dsh-cost-meter host balance module OK");
