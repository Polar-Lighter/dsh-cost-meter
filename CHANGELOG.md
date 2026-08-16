# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v0.0.1] - 2026-08-15

首个正式发布版本。

### ✨ 新增

- **取消底部状态栏**：以 slot 遮蔽机制隐藏输入框下方的常驻统计行（`conversation.composer.dock` 的 `stats` 单元格），台前保持干净。
- **上下文圆环面板内显示会话详情**（`conversation.context.detail` 槽位）：
  - **会话统计**：轮数 / 步数、LLM 与工具调用耗时、首 token 平均耗时、解码吞吐（tok/s）；
  - **Token 用量（按模型分桶）**：host 侧 `tokenUsageByModel` 投影按整个会话日志折叠出每个模型的
    缓存命中 / 未命中 / 写入 / 输出 token 与缓存命中率，多模型会话每个模型一个区块；
  - **费用**：全部模型费用总和（人民币 + 美元，金额字体略大），悬停查看每个模型各自的费用与费率档位；
  - **账户余额**：面板最底部展示 CNY / USD 余额（总余额 = 充值 + 赠送），账户不可用时提示，点击手动刷新；
- **计费口径与官方一致**：缓存写入按缓存未命中价、缓存读取按缓存命中价计费，reasoning token 计入输出；
  支持现行价格与 8-17 起的峰谷定价（北京时间高峰 9:00–12:00、14:00–18:00）。
- **安全设计**：API Key 只在 host 进程使用（余额经 `/rpc → cost-meter/balance` 通道查询），永不进入浏览器。

### 🛠️ 附带

- `tools\apply-bundle-patches.ps1`：幂等补丁脚本（B/C/D/E 四处 `ui-conversation` bundle 补丁，应用更新后可重打）；
- 完整测试套件：客户端 bundle / 投影折叠 / 余额模块 / 安装校验。

[v0.0.1]: https://github.com/Polar-Lighter/dsh-cost-meter/releases/tag/v0.0.1
