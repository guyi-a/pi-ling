# DSH TypeScript SDK Adapter PoC

记录时间：2026-09-06  
DSH：`dsh-v0.1.3-alpha.1` / `d347e703`  
状态：PoC 完成，未替换产品 ACP Runtime

## 目标

验证 `@deepseek-ai/dsh-sdk-client` 是否适合作为 pi-ling 的正式 DSH
Runtime transport。

PoC 位于：

```text
packages/dsh-sdk-runtime
```

## 已验证

- SDK Client 自动启动独立 `dsh --profile sdk` 子进程。
- Windows 下可复用 pi-ling `fs-ext` module hook。
- 一个 SDK sidecar 可以承载多个命名 Session。
- 同一进程、同一 Session 连续两轮对话能够保留上下文。
- 真实 DeepSeek 测试成功回忆 `SDK-EMBER-91`。
- `session.event` 可以映射 Assistant、Reasoning、Tool 和 Usage。
- SDK Profile 支持 DSH_HOME、provider/model、patch 和自定义 Profile。

## SDK 协议限制

当前 SDK wire 只有三个 Client → Server 方法：

```text
initialize
session/prompt
shutdown
```

以及：

```text
session.event
session.status
subagent.started
subagent.finished
```

### 没有单 Session Cancel

没有 wire-level prompt cancel。PoC 只能关闭整个 SDK 子进程，导致同一
sidecar 内其他 Session 一起中断。

### 没有 Approval/Permission Channel

SDK protocol 没有 Server → Client approval request。DSH 工具权限只能在
Profile 内部决定，无法直接映射 pi-ling `manual / accept-write / auto`
和审批 UI。

### 没有显式 Resume/Close

没有 `session/resume` 和 `session/close`。同一进程内复用 Session ID 可以
继续对话，但关闭进程后以同一 DSH_HOME/Session ID 再启动，PoC 已确认无法
通过公开 SDK API恢复该 Session。

### 没有 Live Token Notification

`session.event` 在 durable event 提交后发送。`assistant/message` 内包含
compact stream record，但不是生成期间的 live token notification。

## 与 ACP 对比

ACP 当前已有：

- session new/resume/close
- per-session cancel
- permission request/response
- 标准 message/thought chunk 类型

SDK 的优势：

- 直接暴露完整 DSH durable `SessionEvent`
- 高层 API 简单
- 与 DSH 内部数据模型更接近

但就 pi-ling 产品当前需求而言，SDK 缺失 Cancel、Approval、跨进程 Resume
和 live stream，不能直接替换 ACP。

## 若坚持使用 SDK

需要自定义 DSH SDK Profile/Protocol plugin，增加：

```text
session/cancel
session/resume
session/close
session/request_permission
agent/assistant-stream notification
canonical seed/import
```

这相当于扩展 DSH SDK protocol，而不仅是写一个 RuntimeAdapter。

Canonical Transcript Cordis plugin 仍然需要，它与外部选择 SDK 或 ACP
无关。

## 当前结论

PoC 证明 SDK 的基础进程与事件链路可用，但原版 SDK protocol 不满足
pi-ling 的完整桌面 Runtime Contract。

在没有扩展 SDK protocol 前：

- 不删除 ACP；
- 不把产品 DSH Runtime 切到 SDK；
- `@pi-ling/dsh-sdk-runtime` 仅保留为对照 PoC。
