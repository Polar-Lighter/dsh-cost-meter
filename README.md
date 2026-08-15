# dsh-cost-meter

A [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (DSH) web plugin that hides the composer's bottom status bar and shows the current session's per-model token usage and total cost (CNY + USD) inside the context-meter ring's click-open panel. 中文说明为主。

点击输入框右下角的**上下文占用圆环**即可查看本次会话的详细信息，台前不再常驻显示任何统计文字。
![Uploading 12587042-9102-42da-b062-dced9d9b3cb4.png…]()

## 功能

1. **取消底部状态栏**：用 slot 遮蔽机制（`conversation.composer.dock` 的 `stats` 单元格，更低 `priority`）让原来的统计行不再渲染。

2. **上下文圆环面板内显示会话详情**（`conversation.context.detail` 槽位，渲染在圆环点击面板的占用条下方）：
   - **会话统计**：轮/步、LLM / 工具调用耗时、首 token 平均、吞吐；
   - **Token 用量（按模型分桶）**：host 侧 `tokenUsageByModel` 投影按整个会话日志的
     `request/header`（模型）与用量采样（`assistant/chunk`、`assistant/message`）折叠出每个模型的分桶消耗。
     只用了一个模型就只展示一个区块（含模型名）；用了多个模型则每个模型一个区块
     （模型名 + 命中 / 未命中 / 写入 / 输出 / 缓存命中率）；
   - **费用**：全部模型的总和（人民币 + 美元，金额字体略大），悬停查看每个模型各自的费用与费率。
   - 计费规则与官方一致：缓存写入按缓存未命中（原价输入）计费，缓存读取按缓存命中价计费，reasoning token 已包含在输出 token 内。

## 对已安装 bundle 的必要补丁（应用更新后需重打）

ContextMeter 是 `ui-conversation` 内联渲染的组件，不是插槽。为了让面板能承载插件内容，对已安装的
`@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 打了 4 处小补丁：

- **B** `ContextMeter` 接收 `renderSlot`；
- **C** 面板内渲染新子槽位 `conversation.context.detail`；
- **D** `InputBar` 调用点把 `renderSlot` 传给 `ContextMeter`；
- **E** `InputBar` 注册声明该子槽位（`kind: single, scope: session`）。

（脚本同时会撤销早期迭代遗留的 `rightItems` 重排。）

- 重打脚本：`tools\apply-bundle-patches.ps1`（幂等：已应用的补丁自动跳过；bundle 结构变化会报错提示）。
- 应用更新后运行 `pwsh -File tools\apply-bundle-patches.ps1` 即可恢复。

## 价格（官方，2026-08-15 核录）

单位：¥ / 百万 tokens。8 月 17 日 00:00（北京时间）前执行**现行价格**，之后执行**峰谷定价**
（高峰时段 = 北京时间 9:00–12:00、14:00–18:00，其余为空闲时段；空闲 = 高峰的一半）。

| 模型 | 阶段 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|---|
| deepseek-v4-flash | 现行 | 0.02 | 1.00 | 2.00 |
| deepseek-v4-flash | 8-17 起·空闲 | 0.05 | 1.50 | 4.50 |
| deepseek-v4-flash | 8-17 起·高峰 | 0.10 | 3.00 | 9.00 |
| deepseek-v4-pro | 现行 | 0.025 | 3.00 | 6.00 |
| deepseek-v4-pro | 8-17 起·空闲 | 0.15 | 4.50 | 13.50 |
| deepseek-v4-pro | 8-17 起·高峰 | 0.30 | 9.00 | 27.00 |

价格逻辑位于 `lib/client.js` 的 `PRICE_REGIMES` 常量（人民币 `cny` 与美元 `usd` 两套，官方页面两种货币都有）：
- `flat`：现行价；`peak` / `offpeak`：8-17 起的峰谷价；
- `PEAK_OFFPEAK_START_UTC`：切换时刻（2026-08-17 00:00 北京时间 = 8-16 16:00 UTC）；
- `isBeijingPeak(now)`：按北京时间判断当前是否高峰时段（= UTC 01:00–04:00、06:00–10:00）。

美元价格（官方英文页，$ / 百万 tokens）：

| 模型 | 阶段 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|---|
| deepseek-v4-flash | 现行 | 0.0028 | 0.14 | 0.28 |
| deepseek-v4-flash | 8-17 起·空闲 | 0.007 | 0.22 | 0.66 |
| deepseek-v4-flash | 8-17 起·高峰 | 0.014 | 0.44 | 1.32 |
| deepseek-v4-pro | 现行 | 0.003625 | 0.435 | 0.87 |
| deepseek-v4-pro | 8-17 起·空闲 | 0.022 | 0.66 | 1.98 |
| deepseek-v4-pro | 8-17 起·高峰 | 0.044 | 1.32 | 3.96 |

费用行显示为 `￥… / $ …`（人民币在前、美元在后）。

> 说明：`tokenUsage` 是累计总量、不含每条请求的时间戳，因此费用按**当前时刻**的档位折算
> 整个会话（显示口径的近似，见 `lib/client.js` 注释）。若官方价格再调整，直接改
> `PRICE_REGIMES` 后刷新页面即可生效。

## 安装

1. 把本包放进 profile：`%DSH_HOME%\profiles\web\packages\dsh-cost-meter\`
   （`%DSH_HOME%` 默认是 `C:\Users\<你>\ .dsh`），并在
   `%DSH_HOME%\profiles\node_modules\dsh-cost-meter` 建立指向它的链接（junction）。
2. 在 `%DSH_HOME%\profiles\web\cordis.patch.yml` 插入 loader 行：

   ```yaml
   - insert:
       - id: cost-meter
         name: dsh-cost-meter
   ```

3. 运行 `pwsh -File tools\apply-bundle-patches.ps1`，对安装的 `dsh-client-ui-conversation`
   bundle 应用 B/C/D/E 补丁（见上）。
4. **重启 DeepSeek Harness**（关闭窗口后重新打开），加载器才会把新插件纳入
   `window.__DSH_BOOT__` 客户端图并激活。

## 测试

```bash
node test/harness.mjs            # 客户端 bundle：计价、模板渲染、多模型展示
node test/projection.test.mjs    # host 侧 tokenUsageByModel 折叠单测
```

## 卸载

- 删除 `cordis.patch.yml` 中的 `cost-meter` 插入块；
- 删除 `profiles\node_modules\dsh-cost-meter` 链接与 `profiles\web\packages\dsh-cost-meter` 目录；
- （可选）恢复 `dsh-client-ui-conversation/lib/client.js`（重装应用或手动撤销 B/C/D/E）；
- 重启应用。

## 许可

MIT License，见 [LICENSE](LICENSE)。
