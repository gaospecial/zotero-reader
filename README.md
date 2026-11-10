# Zotero Reader

面向科研工作者的本地优先桌面阅读器：从 Zotero 分类导入文献，使用 Doc2X 解析 PDF，使用 DeepSeek 生成中文七段解读，并围绕单篇论文进行流式问答。

技术栈为 Tauri 2、React 19、TypeScript、Vite、Tailwind CSS 4、Rust 与 SQLite。真实云端 API 调用仅由 Rust 桌面进程发起；API Key 以明文保存在应用 `config.json`，不写入数据库或备份。

## 功能

- 递归选择 Zotero 分类，先预览文献数量并检查 PDF 可读性，再按 100 条分页、幂等导入。
- 未加入分类可在目录中直接加入；已加入分类可右键“与 Zotero 同步”，自动获取新文献、题录变化和 PDF 附件。
- 启动时只读同步已导入条目的题录；不读取或修改 `zotero.sqlite`，不复制 PDF。
- Doc2X PDF 解析、Markdown 版本保存、图片顺序整理及来源章节定位。
- DeepSeek 七段中文解读、论文图片上下文、单篇流式问答与问答历史。
- 已读状态、全文检索、个人备忘、处理失败重试与后台任务取消。
- 无 PDF 条目只展示 Zotero 原始题录与摘要，不调用 AI 解读或问答。
- 应用回收站、恢复，以及经明确确认后同步到 Zotero 回收站。
- SQLite、Markdown 历史版本与图片的 ZIP 备份和恢复。

## 准备

1. 安装 Node.js、npm 和 Rust/Cargo。
2. 启动 Zotero 桌面端，并确保本机 Zotero 服务可通过 `http://127.0.0.1:23119` 访问。
3. 安装前端依赖：

   ```bash
   npm install
   ```

4. 准备 Doc2X 与 DeepSeek API Key。可在“设置 → 服务连接”中录入，也可点击“打开 config.json”直接编辑。首次启动会生成完整的 VS Code 风格扁平 JSON 模板，并将现有环境变量与旧钥匙串中的可用配置一次性迁入；成功写入后清理旧 API Key 钥匙串条目。

   迁移后优先级为：`config.json` 中的显式配置、进程环境变量、登录 Shell 环境变量。macOS 图形启动仍能识别账户实际登录 Shell。环境变量有静态缓存，修改后需重启；应用不会自动加载 `.env` 文件。

配置文件位于应用数据目录，示例（不含真实密钥）：

```json
{
  "config.version": 1,
  "deepseek.apiKey": "",
  "doc2x.apiKey": "",
  "deepseek.model": "deepseek-v4-flash-vision-exp",
  "deepseek.baseUrl": "https://api.deepseek.com",
  "doc2x.downloadHosts": "doc2x.noedgeai.com,noedgeai.com,aliyuncs.com",
  "zotero.dataDir": "",
  "zotero.rootDir": "",
  "zotero.localBaseUrl": "http://127.0.0.1:23119/api/users/0",
  "literatureInterpretation.prompt": "请按照以下步骤对英文文献进行深入解读和分析……"
}
```

密钥以明文保存，不进入数据库或备份。设置页会载入当前配置，API Key 默认以密码框隐藏，可点击眼睛图标主动查看或再次隐藏；Zotero 本地 API 地址以只读方式展示。`literatureInterpretation.prompt` 的默认内容与您提供的完整提示词完全一致，可显式覆盖。模型、接口地址、Zotero 路径和提示词在实际操作时重新读取；修改 `zotero.localBaseUrl` 后需重启应用。

### PDF 路径配置

应用先读取附件元数据并转换本地路径，支持绝对路径、`attachments:`、`storage:` 和纯文件名；本地路径不可用时再降级到 Zotero 文件接口。不会读取 `zotero.sqlite`，也不会复制 PDF。

Zotero 文件接口返回本机 `file://` 重定向时，应用会解码并读取该附件（包括坚果云等同步目录）；网络重定向仍会被拒绝，不会全局放开重定向。预览导入和正式导入都会先检查 PDF 文件头与本机路径。不可读附件会显示警告并被单独跳过，不再阻塞整个分类：同一文献的其他可读 PDF 正常解析，全部不可读时仅保留 Zotero 元信息；修复路径后重新同步可恢复处理。

- `zotero.dataDir` / `ZOTERO_DATA_DIR`：Zotero 数据目录，默认 `~/Zotero`。既可以指向 Zotero 根目录，也可以直接指向其中的 `storage` 目录；自定义数据目录位置时必须设置。
- `zotero.rootDir` / `ZOTERO_ROOT_DIR`：`attachments:` 链接附件的根目录，只在使用这类链接附件时需要设置。

## 启动桌面端

先启动 Zotero，再运行 `npm run desktop:dev`，然后在“设置 → 服务连接”中分别保存 DeepSeek 与 Doc2X API Key。

继续使用环境变量时，可先在登录 Shell 中 `export DEEPSEEK_API_KEY` 和 `DOC2X_API_KEY`，再从终端或 Finder 启动。不要把密钥写入 `VITE_` 变量或前端源码。

### 浏览器演示

```bash
npm run dev
```

浏览器模式使用明确标识的演示数据，用于预览文库、阅读和导入交互；它不连接真实 Zotero、Doc2X、DeepSeek 或本地 SQLite。真实功能请使用桌面端。

## 数据与备份

应用数据保存在 Tauri 的应用数据目录中，包括：

- `reader.db`：文献元数据、分类关系、解读索引、备忘、问答、状态和设置。
- `config.json`：API Key、模型、接口地址、Zotero 路径和提示词等明文配置。
- `files/`：按文献及版本保存的 Markdown 与图片。

PDF 根据 Zotero 附件元数据从原位置按需读取，本地路径不可用时使用 Zotero 文件接口，不进入应用备份。API Key 也不写入备份。恢复备份会替换当前本地数据库与解析文件，操作前建议先导出一份新备份。

## 测试与验证

```bash
# React 交互测试
npm test

# TypeScript 与前端生产构建
npm run build

# Rust 单元测试
cd src-tauri && cargo test && cd ..

# 真实 Chromium 页面检查及截图
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=0 node scripts/visual-check.mjs

# 桌面可执行程序
npm run desktop:build -- --no-bundle

# 当前平台的应用与安装包
npm run desktop:build

# macOS .app（与 CI 桌面构建任务一致）
npm run desktop:build -- --bundles app
```

截图输出到 `artifacts/`。桌面构建产物位于 `src-tauri/target/release/` 与 `src-tauri/target/release/bundle/`。

打包不会把 API Key 嵌入应用。从 Finder 启动应用后，可直接在“设置 → 服务连接”保存密钥；环境变量方式仍然兼容，适合从终端启动的场景。

## 提交与版本号

所有新 commit 都必须更新版本号，并采用 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/) 的 `MAJOR.MINOR.PATCH` 格式。版本变更必须与该提交的其他变更位于同一个 commit，并同步更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json`。左侧栏顶部版本号由 `src/components/Sidebar.tsx` 直接读取 `package.json`，不得在界面代码中另外写死。

完整递增规则、版本同步位置及 `amend`、发布标签的处理方式见 `AGENTS.md` 的“Git 提交与版本号”。历史提交不追溯修改。

## 持续集成

GitHub Actions 工作流位于 `.github/workflows/ci.yml`，在以下情况自动运行：

- 向 `main` 分支推送提交；
- 向 `main` 分支发起或更新 Pull Request；
- 在 GitHub Actions 页面手动触发。

工作流包含三个任务：

1. **Frontend tests and build**：使用 Node.js 22 安装锁定依赖，运行 React 测试与前端生产构建。
2. **Rust tests**：在 Ubuntu 上安装 Tauri 所需系统依赖，运行 `cargo test --locked`。
3. **macOS desktop build**：前两个任务通过后构建 `.app`，并上传名为 `zotero-reader-macos` 的构建工件，保留 7 天。

CI 生成的 macOS 应用使用临时签名且未经 Apple 公证，仅用于开发验证。正式分发仍需配置 Apple 签名与公证凭据。

## 当前验证范围

- 13 项 React 交互测试通过，覆盖文库、阅读、分类加入与右键同步、服务当前配置展示、密钥保存与可见性切换、重试刷新、无全文条目的纯元信息展示，以及 PDF 不可读时警告并继续导入。
- 32 项 Rust 测试通过，覆盖递归分类、幂等同步、PDF 增量更新、无 PDF 时禁用 AI 队列并隐藏旧解读、失效附件单独跳过且不阻塞其他文献、导入前 `file://` 重定向预检、网络重定向拒绝、VS Code 风格 JSON 配置、一次性环境迁移、Markdown 相对路径读取、模型字段兼容、安全下载与 API 服务配置。
- Chromium 文库、分类右键菜单、AI 阅读页与无全文元信息页截图检查通过，无页面脚本错误。
- 前端生产构建、Rust release 构建、macOS `.app` 与 `.dmg` 打包通过。
- 已完成真实云端验证：现有密钥成功迁入 `config.json`，并在环境变量故意设为无效值时仍由文件配置驱动 DeepSeek 生成七段解读；曾返回 302 的真实附件通过导入前检查（`issues=0`）；完整 PDF 链路已生成 Markdown 版本及七段解读。默认完整文献解读提示词保持原样。
