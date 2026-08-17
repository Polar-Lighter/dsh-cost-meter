<div align="center">

# 🧮 dsh-cost-meter

**DeepSeek Harness 会话计价与余额监控插件** · 隐藏底部状态栏，把会话详情装进上下文圆环

<sub>DSH (DeepSeek Harness) web plugin — session cost meter + account balance in the context-ring panel</sub>

[![Version](https://img.shields.io/badge/version-v0.0.1-blue)](https://github.com/Polar-Lighter/dsh-cost-meter/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness%20Web-8A2BE2)](https://deepseek-harness.github.io/deepseek-harness/)

</div>

---

## 📸 截图

点击输入框右下角的**上下文占用圆环**，即可在展开的面板中查看本次会话的完整详情——台前不再常驻任何统计文字。

<img width="1683" height="1187" alt="image" src="https://github.com/user-attachments/assets/3890181e-e73e-44b2-ae9c-c31850773ac8" />

---

## ✨ 现有功能

### 1. 🧹 取消底部状态栏

用 slot 遮蔽机制隐藏输入框下方的常驻统计行（`conversation.composer.dock` 的 `stats` 单元格，以更低 `priority` 遮蔽），台前保持干净。

### 2. 🎯 上下文圆环面板内的会话详情

圆环点击面板（`conversation.context.detail` 槽位，渲染在上下文占用条下方）依次展示四个区块：

| 区块 | 内容 |
|---|---|
| **会话统计** | 轮数 · 步数；LLM / 工具调用耗时；首 token 平均耗时；解码吞吐（tok/s） |
| **Token 用量** | 按模型分桶（一个模型一个区块）：缓存命中 / 未命中 / 写入 / 输出 token、缓存命中率 |
| **费用** | 全部模型费用总和（人民币 + 美元，金额字体略大）；悬停查看每个模型各自的费用与费率档位 |
| **余额** | 账户余额（CNY / USD，总余额 = 充值 + 赠送）；账户不可用时提示；点击可手动刷新 |

**多模型会话**：host 侧 `tokenUsageByModel` 投影按整个会话日志折叠出**每个模型**的 token 分桶
（`request/header` 提供模型，`assistant/chunk` 用量帧与 `assistant/message` 提供用量采样），
费用按各模型实际用量分别计价后求和——会话中途切换模型也准确。

**计费口径与官方一致**：
- 缓存写入 token 按缓存未命中（原价输入）计费；
- 缓存读取 token 按缓存命中价计费；
- reasoning token 已包含在输出 token 内，不重复计费。

### 3. 💰 账户余额

打开面板时，浏览器端通过 host 侧的 RPC 端点（`/rpc → cost-meter/balance`）调用官方接口
[GET /user/balance](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)：

- **API Key 永不离开 host 进程**——浏览器只拿到查询结果，密钥由 host 持有；
- Key 与端点解析方式与官方 `llm-deepseek` 插件一致：优先 `llm-deepseek` 设置节
  （`apiKeyEnv` / `baseURL`）→ `$DEEPSEEK_BASE_URL` → 默认 `DEEPSEEK_API_KEY` / `https://api.deepseek.com`；
- 打开面板自动刷新（60 秒缓存），点击「更新于 … · 点击刷新」手动刷新；
- 未配置 API Key 时余额区块自动隐藏；请求失败显示「余额获取失败 · 点击重试」。

---

## 🏗️ 工作原理

```
┌─ 浏览器（web 客户端）──────────────────────────────────────┐
│  圆环面板 ← conversation.context.detail 槽位               │
│    ├─ 会话统计 / Token 用量 / 费用 ← sessionProjections     │
│    │     （tokenUsage · tokenUsageByModel · sessionStats） │
│    └─ 余额 ← RPC: /rpc → cost-meter/balance               │
└──────────────┬─────────────────────────────┬──────────────┘
               │                             │ Connection RPC
               ▼                             ▼
┌─ host 进程 ────────────────────────────────────────────────┐
│  tokenUsageByModel 投影折叠整段会话日志                     │
│  GET /user/balance（API Key 只在这里）                     │
└────────────────────────────────────────────────────────────┘
```

> **依赖**：`dsh-client-ui-conversation` 的 bundle 需要打补丁（见下方「必要补丁」），
> 应用更新后需重打；其余功能（投影、RPC）均为插件自带，无需改动应用本体。

---

## 💵 价格表（官方，2026-08-15 核录）

单位：¥ / 百万 tokens。8 月 17 日 00:00（北京时间）前执行**现行价格**，之后执行**峰谷定价**
（高峰 = 北京时间 9:00–12:00、14:00–18:00；空闲 = 高峰的一半）。

| 模型 | 阶段 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|---|
| deepseek-v4-flash | 现行 | 0.02 | 1.00 | 2.00 |
| deepseek-v4-flash | 8-17 起 · 空闲 | 0.05 | 1.50 | 4.50 |
| deepseek-v4-flash | 8-17 起 · 高峰 | 0.10 | 3.00 | 9.00 |
| deepseek-v4-pro | 现行 | 0.025 | 3.00 | 6.00 |
| deepseek-v4-pro | 8-17 起 · 空闲 | 0.15 | 4.50 | 13.50 |
| deepseek-v4-pro | 8-17 起 · 高峰 | 0.30 | 9.00 | 27.00 |

美元价格（官方英文页，$ / 百万 tokens）：

| 模型 | 阶段 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|---|
| deepseek-v4-flash | 现行 | 0.0028 | 0.14 | 0.28 |
| deepseek-v4-flash | 8-17 起 · 空闲 | 0.007 | 0.22 | 0.66 |
| deepseek-v4-flash | 8-17 起 · 高峰 | 0.014 | 0.44 | 1.32 |
| deepseek-v4-pro | 现行 | 0.003625 | 0.435 | 0.87 |
| deepseek-v4-pro | 8-17 起 · 空闲 | 0.022 | 0.66 | 1.98 |
| deepseek-v4-pro | 8-17 起 · 高峰 | 0.044 | 1.32 | 3.96 |

费用行显示为 `￥… / $ …`（人民币在前、美元在后）。

> 📌 **官方价格再调整时**：直接修改 `lib/client.js` 中的 `PRICE_REGIMES` 常量
> （`cny` / `usd` 两套），刷新页面即可生效。

---

## 🔧 安装

### 1. 放入 profile 并链接

```powershell
# %DSH_HOME% 默认是 C:\Users\<你>\.dsh
$dst = "$env:USERPROFILE\.dsh\profiles\web\packages\dsh-cost-meter"
# 把本仓库内容复制到 $dst
# 然后建立 junction 链接：
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-cost-meter" -Target $dst
```

### 2. 注册 loader

在 `%DSH_HOME%\profiles\web\cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: cost-meter
      name: dsh-cost-meter
```

### 3. 应用 bundle 补丁（必须）

```powershell
pwsh -File tools\apply-bundle-patches.ps1
```

### 4. 重启应用

**重启 DeepSeek Harness**（关闭窗口重新打开），加载器才会把插件纳入客户端图并激活。

---

## 🩹 必要补丁（应用更新后需重打）

ContextMeter 是 `ui-conversation` 内联渲染的组件，不是插槽。为了让面板承载插件内容，
对已安装的 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 打了 4 处小补丁：

- **B** — `ContextMeter` 接收 `renderSlot`；
- **C** — 面板内渲染新子槽位 `conversation.context.detail`；
- **D** — `InputBar` 调用点把 `renderSlot` 传给 `ContextMeter`；
- **E** — `InputBar` 注册声明该子槽位（`kind: single, scope: session`）。

- 重打脚本 `tools\apply-bundle-patches.ps1` **幂等**：已应用的补丁自动跳过，bundle 结构变化会报错提示；
- **应用更新后**运行一遍即可恢复。

---

## 🔄 更新

1. 拉取新版本并覆盖 `%DSH_HOME%\profiles\web\packages\dsh-cost-meter\`（`lib\`、`package.json` 等）；
2. 运行 `pwsh -File tools\apply-bundle-patches.ps1`（如应用更新过则必跑）；
3. **重启应用**（host 侧有改动时）或刷新页面（仅客户端 bundle 改动时）。

---

## 🧪 测试

```bash
node test/harness.mjs            # 客户端 bundle：计价、模板渲染、多模型展示、余额区块
node test/projection.test.mjs    # host 侧 tokenUsageByModel 折叠单测
node test/balance.test.mjs       # host 侧余额模块（Key 解析、接口折叠、RPC 注册）单测
node test/verify-install.mjs     # 安装校验（patch / 解析 / bundle 注册）
```

---

## 📦 发布包

- 源码打包：`dsh-cost-meter-v0.0.1.zip`（Release 资产，见 [Releases](https://github.com/Polar-Lighter/dsh-cost-meter/releases)）；
- 更新日志见 [CHANGELOG.md](CHANGELOG.md)。

## 🗑️ 卸载

1. 删除 `cordis.patch.yml` 中的 `cost-meter` 插入块；
2. 删除 `profiles\node_modules\dsh-cost-meter` 链接与 `profiles\web\packages\dsh-cost-meter` 目录；
3. （可选）重装应用或手动撤销 B/C/D/E 补丁；
4. 重启应用。

---

## 📄 许可

MIT License，见 [LICENSE](LICENSE)。© 2026 [Polar-Lighter](https://github.com/Polar-Lighter)。
