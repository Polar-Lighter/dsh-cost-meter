// Verify the installed plugin from the DSH web profile's resolution context.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const req = createRequire("C:/Users/Lenovo/.dsh/profiles/web/x.js");

// 1) YAML parse via the profile's js-yaml (same parser family the loader uses)
const yaml = req("js-yaml");
const doc = yaml.load(readFileSync("C:/Users/Lenovo/.dsh/profiles/web/cordis.patch.yml", "utf8"));
console.log("yaml:", JSON.stringify(doc));
if (!Array.isArray(doc) || doc.length !== 1) throw new Error("patch should be a 1-element array");
const ins = doc[0].insert;
if (!ins || ins.length !== 1 || ins[0].id !== "cost-meter" || ins[0].name !== "dsh-cost-meter") {
  throw new Error("bad insert row");
}

// 2) package resolution from the profile root (as the loader / client-modules do)
const pkgJson = req.resolve("dsh-cost-meter/package.json");
const clientPath = req.resolve("dsh-cost-meter/client");
console.log("package.json:", pkgJson);
console.log("client bundle:", clientPath);
const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
console.log("dsh.client:", JSON.stringify(pkg.dsh.client));
if (pkg.dsh?.client?.platform !== "web") throw new Error("bad dsh.client platform");

// 3) client bundle executes and registers the factory with the right id
let handoff = null;
globalThis.window = { __ModuleLoader__: { load(h) { handoff = h; } } };
new Function(readFileSync(clientPath, "utf8"))();
if (!handoff || handoff.id !== "dsh-cost-meter") throw new Error("bundle did not register");
console.log("bundle handoff id:", handoff.id);
console.log("RESOLUTION OK");
