# pi-ling 开发指南

最后更新：2026-09-11

## 项目目标

在本仓库独立开发 Electron Coding Agent 产品，统一提供聊天、代码修改、终端、Diff、审批、会话恢复和评测体验。

- 不修改或复制 LingCoWork 主工程；LingCoWork 仅作需求与评测参考。
- 产品统一支持 **Native**、**DSH（DeepSeek Harness）**、**Codex** 三套 Runtime，可在同一会话内切换。
- Native 模型层通过 pi-ai 接入多家 Provider；设置页提供常用 Provider 清单，Codex/DSH 有各自支持范围。

## 技术栈

- **Electron + React + TypeScript** monorepo
- Renderer 只负责 UI，不持有密钥，不直接访问文件系统
- Renderer 通过 Preload IPC 调用 Main
- Main `SessionSupervisor` 负责会话路由、持久化、审批策略、Runtime 生命周期
- Runtime 运行在 Main 进程适配层或 sidecar 子进程中，不阻塞 Renderer

```text
Electron Renderer (Chat / Files / Changes / Terminal / Settings)
        ↓ typed preload IPC
Electron Main
  ├─ SessionSupervisor + SQLite session store
  ├─ llm-config（设置 / .env / userData/llm-config.json）
  └─ RuntimeAdapter
        ├─ Native  → @pi-ling/coding-agent → @pi-ling/agent-core → pi-ai
        ├─ DSH     → ACP stdio → pinned DSH sidecar (dsh-v0.1.3-alpha.1)
        └─ Codex   → @openai/codex-sdk → bundled codex binary
```

## 目录结构

| 路径 | 说明 |
|------|------|
| `apps/desktop/` | Electron 主进程、Preload、Renderer |
| `packages/agent-core/` | ReAct 循环、工具接口 |
| `packages/coding-agent/` | Native Harness（tools、approval、skills、workspace） |
| `packages/native-runtime/` | Native RuntimeAdapter |
| `packages/dsh-runtime/` | DSH ACP 适配 |
| `packages/codex-runtime/` | Codex SDK 适配 |
| `packages/llm-config/` | Provider 目录、配置解析（设置 + env） |
| `packages/skills/` | 统一 Skill 加载（`.agents/skills`） |
| `packages/session-events/` | Canonical 投影与 Timeline |
| `packages/coding-eval/` | 评测工具链 |
| `.agents/skills/` | 内置 Skill（`pnpm skills:sync` 同步） |

## 三套 Runtime

### Native

- 默认 Provider/模型：`deepseek` / `deepseek-flash`（DeepSeek V4.1 Flash）
- 通过 `registerPiLingDeepseekProvider` 注册 pi-ai 尚未收录的 `deepseek-flash` ID
- 设置页可选 Provider：DeepSeek、Anthropic、MiniMax、Moonshot/Kimi、Kimi For Coding、Z.AI/GLM 等（Native only）
- Skills：`.agents/skills` + `load_skill` 工具；workspace 切换时 reload

### DSH

- 固定版本：`dsh-v0.1.3-alpha.1` / commit `d347e703…`
- 启用：`PI_LING_DSH_ENABLED=true`，首次运行 `pnpm dsh:setup`
- 模型：跟随全局 LLM 配置；**仅支持 DeepSeek 与 Anthropic**
- ACP profile 由 `buildDshPiAiProfilePatch()` 按当前 provider/model 生成
- Windows：`fs-ext-hook` 隔离 DSH 未使用的 POSIX 依赖

### Codex

- 启用：`PI_LING_CODEX_ENABLED=true` + DeepSeek API Key
- 模型：跟随全局配置；**仅支持 DeepSeek**（Responses API）
- `PI_LING_CODEX_HOME` 隔离 config.toml / models.json
- 支持 Native ↔ DSH ↔ Codex 同会话切换（canonical import + watermark）

## LLM 配置

优先级：**设置页 `llm-config.json` > `.env` > 内置默认**。

| 环境 | `.env` 位置 |
|------|-------------|
| 开发 `pnpm dev` | 仓库根目录 `.env` |
| 打包安装版 | `%APPDATA%/@pi-ling/desktop/.env`（首次启动可导入） |

设置页保存到 `userData/llm-config.json`。未在设置中保存时，API Key 与可选 `PI_LING_PROVIDER` / `PI_LING_MODEL` 从 `.env` 读取。

可选 env 见 `.env.example`：`PI_LING_DSH_*`、`PI_LING_CODEX_*`、`DEEPSEEK_BASE_URL` 等。

## Skills

- 统一目录：`<workspace>/.agents/skills/<skill-name>/SKILL.md`
- Native：`load_skill` + system prompt 索引
- Codex：`skills/list`、extraRoots、changed 通知
- DSH：同路径发现；smoke 见 `packages/dsh-runtime`
- 同步内置 Skill：`pnpm skills:sync`

## 会话与事件

- **Session Event Log**（SQLite）为唯一权威事实源
- Canonical Messages、Timeline、Run Activity 均为投影
- 用户可见 Assistant 文本：完整 message 落库后，Renderer presentation queue 分块展示（非 token 级）
- 详见 [`docs/agent-streaming-and-run-rendering.md`](docs/agent-streaming-and-run-rendering.md)、[`docs/canonical-transcript-design.md`](docs/canonical-transcript-design.md)
- 审批三档：`manual` / `accept-write` / `auto`；未知 effect 始终询问
- Agent 默认 max turns：**50**；流错误 `terminated` 等可自动重试（最多 3 次）

## 安全边界

- API Key 仅 Main 读写；Renderer 只见 `apiKeyConfigured` / 脱敏 preview
- 文件写入、命令执行等副作用统一建模并审批
- IPC 白名单通道 + 结构化参数；Renderer 不暴露通用 Node API

## 常用命令

```bash
pnpm install
pnpm skills:sync          # 同步内置 skills 到 .agents/skills
pnpm dev                    # 构建 packages 后启动 Electron
pnpm test                   # 全仓测试
pnpm dsh:setup              # 准备 pinned DSH worktree
pnpm dsh:verify
```

打包：仅用户明确要求时执行 `pnpm dist:win`（不要 CI/Agent 自动打包）。

## 开发约束

- 修改 IPC 契约时同步 contracts、Preload、Main、Renderer
- 不引入产品级插件/extension API；能力放在 `coding-agent` 内部模块
- DSH 依赖固定版本 + ACP 契约测试；Codex 固定 `@openai/codex-sdk` 0.154.0
- 参考项目：`E:\LingCoWork`（UI/行为）、`vendor/pi-ai`（MIT 参考，非运行依赖）

## 参考文档

| 文档 | 说明 |
|------|------|
| [`docs/agent-streaming-and-run-rendering.md`](docs/agent-streaming-and-run-rendering.md) | 流式、持久化、UI 投影分层 |
| [`docs/canonical-transcript-design.md`](docs/canonical-transcript-design.md) | Canonical Transcript 与跨 Runtime handoff |
| [`docs/interview/`](docs/interview/) | 面试材料（勿删） |
| 各 `packages/*/README.md` | Runtime 与模块细节 |
