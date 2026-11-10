# 更新日志

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- 左侧栏实时显示未删除备忘的数量，并在新增、删除和清空备忘后同步刷新。

### 变更

- 备忘卡片完整显示选段原文，并按内容自然高度排列，不再统一截断为四行。
- 从备忘中心回到原文时清除文库筛选并定位对应高亮，不再自动打开编辑窗口。

### 修复

- 旧版解读的备忘无法匹配相同文字时，回退定位到原章节并明确提示。
- 修复浏览器演示模式清空总备忘后计数残留的问题。

## [0.5.5] - 2026-11-10

### 新增

- 添加项目更新日志，按版本回溯并记录 `0.1.0` 至当前版本的重要变更。

### 变更

- 在 README 的“提交与版本号”章节添加更新日志入口。
- 在 AGENTS 中补充更新日志维护规则，要求重要变更与代码、版本号在同一提交中同步记录。

## [0.5.4] - 2026-11-10

### 修复

- 打开未读文献时保留其 `updated_at`，避免文库列表因已读状态变化而重新排序。
- 防止非活动浮动图片改变前方阅读区高度，并按部分可见条目的实际位置保持滚动锚点。
- 增加阅读列表排序与滚动定位的回归测试。

## [0.5.3] - 2026-11-10

### 变更

- 将持续集成环境的 Node.js 版本与本地开发环境对齐。

## [0.5.2] - 2026-11-10

### 修复

- 左侧栏直接读取 `package.json` 中的完整 SemVer 版本号，避免界面版本与项目版本基准不一致。

## [0.5.1] - 2026-11-10

### 修复

- 恢复阅读页行内图片的文字环绕布局。

## [0.5.0] - 2026-11-09

### 新增

- 阅读页图片轮播支持调整尺寸，便于按阅读需求查看论文图片。

## [0.4.0] - 2026-11-09

### 新增

- 设置页支持查看和编辑文献解读提示词，并用于后续 AI 解读。

## [0.3.0] - 2026-11-09

### 变更

- 弱化显示尚无文献解读的分类，便于快速定位已有内容的分类。

## [0.2.0] - 2026-11-09

### 新增

- 支持基于原文位置创建锚点笔记，并提供可调整宽度的侧栏。
- 支持彩色高亮，并持久保存分类展开状态。
- 增加图片灯箱预览与浮动图片布局。
- 改进论文图片、笔记和分类导入体验。

### 变更

- 调整紧凑排版，仅为未读文献标题使用粗体。

### 修复

- 修复 macOS 发布工件的输出路径。
- 展开行内阅读区时保持侧栏选择和列表位置稳定，并保留已展开文献直至手动收起。
- 收起星标文献时保持阅读滚动位置，并在自动更新已读状态后同步未读数量。

## [0.1.0] - 2026-11-05

### 新增

- 首个 Zotero Reader 桌面版本，基于 Tauri 2、React、TypeScript、Rust 与 SQLite。
- 从 Zotero 分类预览并导入文献，支持分类同步、全文检索、已读状态与处理失败重试。
- 使用 Doc2X 解析 PDF，保存 Markdown 与图片，并通过 DeepSeek 生成中文七段解读。
- 支持单篇论文流式问答、问答历史与个人备忘。
- 支持应用回收站，以及 SQLite、Markdown 历史版本和图片的 ZIP 备份与恢复。
- 提供浏览器演示模式、自动化测试、桌面构建与跨平台发布工作流。

[未发布]: https://github.com/gaospecial/zotero-reader/compare/v0.5.5...HEAD
[0.5.5]: https://github.com/gaospecial/zotero-reader/compare/dc4beee...v0.5.5
[0.5.4]: https://github.com/gaospecial/zotero-reader/compare/dabd41f...dc4beee
[0.5.3]: https://github.com/gaospecial/zotero-reader/compare/f82df6f...dabd41f
[0.5.2]: https://github.com/gaospecial/zotero-reader/compare/ebf180a...f82df6f
[0.5.1]: https://github.com/gaospecial/zotero-reader/compare/52f6ec6...ebf180a
[0.5.0]: https://github.com/gaospecial/zotero-reader/compare/5c1f87d...52f6ec6
[0.4.0]: https://github.com/gaospecial/zotero-reader/compare/b569979...5c1f87d
[0.3.0]: https://github.com/gaospecial/zotero-reader/compare/0f0c098...b569979
[0.2.0]: https://github.com/gaospecial/zotero-reader/compare/v0.1.0...0f0c098
[0.1.0]: https://github.com/gaospecial/zotero-reader/releases/tag/v0.1.0
