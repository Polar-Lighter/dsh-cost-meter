// Publish the v0.0.1 GitHub Release + upload the source zip asset.
//
// Usage:
//   $env:GH_TOKEN = "<fine-grained PAT>"; node tools/publish-release.mjs
//
// The token is read from the GH_TOKEN environment variable ONLY — it is never
// written to a file and never appears on a command line. It must be a
// fine-grained PAT with Contents: Read and write on this repository (releases
// are covered by Contents) or a classic token with the `repo` scope.
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("C:/Users/Lenovo/.dsh/profiles/web/x.js");
const fetch = require("node-fetch").default;
const { HttpsProxyAgent } = require("https-proxy-agent");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("GH_TOKEN environment variable is required");
  process.exit(1);
}

const OWNER = "Polar-Lighter";
const REPO = "dsh-cost-meter";
const TAG = "v0.0.1";
const ZIP = join("E:/Code/Python/LLM/Learning/Agent", "dsh-cost-meter-v0.0.1.zip");
const API = "https://api.github.com";
const agent = new HttpsProxyAgent("http://127.0.0.1:7890");

const headers = {
  authorization: `Bearer ${TOKEN}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "dsh-cost-meter-publish",
};

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, agent, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    console.error(`API ${options.method || "GET"} ${url} → HTTP ${res.status}`);
    console.error(JSON.stringify(body, null, 2).slice(0, 2000));
    process.exit(1);
  }
  return body;
}

// Release body: the [v0.0.1] section of CHANGELOG.md plus an install hint.
const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
const match = changelog.match(/## \[v0\.0\.1\][\s\S]*?(?=## \[|$)/);
const body = [
  (match ? match[0].trim() : "v0.0.1"),
  "",
  "---",
  "",
  "### 📦 安装",
  "下载 `dsh-cost-meter-v0.0.1.zip`，按 [README](https://github.com/Polar-Lighter/dsh-cost-meter#readme) 的「安装」章节放入 profile、注册 loader、应用补丁后重启 DeepSeek Harness。",
].join("\n");

// 1) Create the release (fails if the tag already exists).
const size = statSync(ZIP).size;
console.log(`creating release ${TAG}…`);
const release = await api(`${API}/repos/${OWNER}/${REPO}/releases`, {
  method: "POST",
  body: JSON.stringify({
    tag_name: TAG,
    target_commitish: "main",
    name: TAG,
    body,
    draft: false,
    prerelease: false,
  }),
});
console.log(`release created: ${release.html_url}`);

// 2) Upload the zip as a release asset.
console.log(`uploading ${ZIP} (${size} bytes)…`);
const upload = await api(release.upload_url.replace("{?name,label}", "?name=dsh-cost-meter-v0.0.1.zip"), {
  method: "POST",
  headers: { "content-type": "application/zip" },
  body: readFileSync(ZIP),
});
console.log(`asset uploaded: ${upload.browser_download_url}`);
console.log("PUBLISH OK");
