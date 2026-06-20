# AI 趋势定时汇总

> 基于 OpenAI Agents SDK 构建的定时 AI 资讯聚合 Agent，部署在 EdgeOne Makers 上 — 自动采集、筛选、评分并生成每日趋势报告。

**框架：** OpenAI Agents SDK · **分类：** Scheduled · **语言：** TypeScript

[![部署到 EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=ai-trends-scheduled-summary&from=within&fromAgent=1&agentLang=typescript)

## 概览

AI 趋势定时汇总通过 4-Agent 流水线，按每日定时任务（或手动触发）从 Hacker News、Dev.to 及可配置的 Web 源采集 AI 行业资讯，生成结构化的 Markdown 趋势报告。整个流水线通过 SSE 实时推送进度，用户可以看到资讯被逐步采集、筛选、评分和撰写的全过程。

- **多源采集** — 从 Hacker News、Dev.to 及可配置 Web 源（通过沙箱浏览器抓取）获取数据
- **4-Agent 流水线** — Curator（筛选）+ Summarizer（摘要）并行执行，随后 Analyst（评分+分类）和 Writer（撰写报告）
- **实时 SSE 流式推送** — 从采集到最终报告的渐进式内容展示，Writer 阶段逐 token 流式输出
- **跨 run 去重** — 基于指纹的条目库，跨定时任务追踪 `seenCount`、`firstSeenAt`、`lastSeenAt`
- **综合评分** — Analyst 根据源站热度、内容质量和 AI 相关度为每条资讯打 0–100 综合分

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | 模型网关 API Key。使用 **Makers Models API Key**，或任何 OpenAI 兼容的服务商 Key。 |
| `AI_GATEWAY_BASE_URL` | 是 | 网关 Base URL。Makers Models 请填 `https://ai-gateway.edgeone.link/v1`。 |
| `AI_GATEWAY_MODEL` | 否 | 模型 ID。默认 `@makers/minimax-m2.7`。 |

> 本模板遵循 **OpenAI 兼容** 标准 — 可以指向 Makers Models 或任何兼容的网关/服务商。

### 如何获取 `AI_GATEWAY_API_KEY`

1. 打开 [Makers 控制台](https://console.cloud.tencent.com/edgeone/makers)。
2. 登录并开通 Makers。
3. 进入 **Makers → 模型 → API Key**，创建一个 Key。
4. 将其填入 `AI_GATEWAY_API_KEY`（`AI_GATEWAY_BASE_URL` 设为 `https://ai-gateway.edgeone.link/v1`）。

内置模型（`@makers/deepseek-v4-flash`、`@makers/hy3-preview`、`@makers/minimax-m2.7`）免费且有速率限制，适合验证原型。生产环境建议在控制台绑定自有服务商 Key（BYOK）。

### 服务商 fallback

代码按以下优先级读取环境变量：

```
LLM_API_KEY → AI_GATEWAY_API_KEY → OPENAI_API_KEY
LLM_BASE_URL → AI_GATEWAY_BASE_URL → OPENAI_BASE_URL
LLM_MODEL → AI_GATEWAY_MODEL → @makers/minimax-m2.7
```

可根据服务商偏好设置任意一组。

## 本地开发

**前置依赖：** Node.js ≥ 18、npm

```bash
npm install
cp .env.example .env
edgeone makers dev
```

打开 `http://localhost:8080/agent-metrics` 查看本地可观测面板。

## 项目结构

```text
ai-trends-scheduled-summary/
├── agents/
│   └── ai-trends/
│       ├── run.ts              # /ai-trends/run — 流水线入口（SSE 流）
│       ├── stop.ts             # /ai-trends/stop — 中止运行中的流水线
│       ├── _model.ts           # 4-Agent 定义、prompt、流式逻辑
│       ├── _sources.ts         # 数据采集（HN、Dev.to、沙箱浏览器）
│       ├── _items.ts           # 条目库：指纹、合并、去重
│       ├── _memory.ts          # 平台 store 持久化（报告+条目）
│       ├── _storage.ts         # 文件系统 fallback 持久化
│       ├── _report.ts          # 报告组装辅助函数
│       ├── _http.ts            # 请求/响应工具函数
│       └── _types.ts           # 共享 Zod schema 与 TypeScript 类型
├── cloud-functions/
│   └── ai-trends/
│       ├── latest/index.ts     # GET /ai-trends/latest
│       ├── history/index.ts    # GET /ai-trends/history
│       ├── detail/index.ts     # POST /ai-trends/detail
│       ├── delete/index.ts     # POST /ai-trends/delete
│       └── health/index.ts     # GET /ai-trends/health
├── src/                        # 前端（React + Vite）
│   ├── App.tsx                 # 主界面：LiveFeed、PipelineBar、ReportDrawer
│   ├── api.ts                  # SSE 客户端 & REST 封装
│   ├── i18n.tsx                # 中英文国际化
│   ├── MarkdownReport.tsx      # Markdown 渲染组件
│   ├── reportModel.ts          # 前端报告数据归一化
│   └── types.ts                # 前端类型定义
├── edgeone.json                # Agent 运行时 & 定时任务配置
└── package.json
```

> 以 `_` 前缀命名的文件为私有模块，不会被 EdgeOne 暴露为公开路由。

## 工作原理

Agent 以 **会话模式** 运行在 `agents/` 下。相同 `conversation_id` 的请求会路由到同一实例（及同一沙箱）。

### 流水线流程

1. **触发** — 通过 cron 定时任务（`0 9 * * *` 每日执行）或手动 POST `/ai-trends/run`。请求包含 `sources`（默认：`hackernews`、`devto`、`web`）和 `limit`。

2. **采集 & 合并** — 从各配置源采集候选内容。Hacker News 和 Dev.to 使用公开 API；Web 源使用沙箱浏览器（`context.sandbox.browser.goto` + `evaluate`）抓取 JS 渲染页面。候选内容通过 URL/标题指纹与条目库去重。

3. **Curator + Summarizer（并行）** — 两个 Agent 通过 `Promise.allSettled` 并发执行：
   - **Curator** 过滤无关内容，分配分类（`AI Agent`、`LLM`、`Multimodal` 等），决定保留/丢弃。
   - **Summarizer** 为每条资讯生成 1–2 句中文摘要。

4. **Analyst** — 为每条资讯打 0–100 综合推荐分（权重：质量 40%、热度 30%、相关度 30%），按分类分组，标注 new/active/single 状态，可选对 2–3 篇最重要的文章通过 `fetch_url` 沙箱工具深入分析。

5. **Writer（逐 token 流式）** — 生成结构化 Markdown 报告，逐 token 流式推送到客户端。实时过滤 `<think>` 标签。连接失败时自动回退到非流式重试。

6. **持久化** — 最终报告保存到 `context.store`（平台 Memory）。不可用时回退到文件系统存储。

### SSE 流式协议

`/ai-trends/run` 端点返回 SSE 流，包含以下类型化事件：

| 事件类型 | 用途 |
|---------|------|
| `stage` | 流水线阶段状态转换（`running` / `done` / `failed`） |
| `items` | 渐进式内容快照（`fetched` → `curated` → `summarized`） |
| `analysis` | Analyst 输出（分类、评分、keyInsight） |
| `progress` | 长时 LLM 调用期间的保活信号（每 8s 发送） |
| `token` | Writer Markdown token（实时打字效果） |
| `complete` | 终止事件，携带完整 `TrendReport` 数据 |

### 核心设计决策

- **逐级降级** — Writer 失败则从 Analyst 输出组装报告；Analyst 也失败则使用代码生成的兜底报告。
- **AbortSignal** — 贯穿所有阶段；用户可随时中止生成。
- **会话级存储** — 报告和条目库通过 `context.store.appendMessage` / `getMessages` 按会话隔离存储。

### 运行时配置

`edgeone.json` 关键参数：
- `agents.timeout`：1200s（流水线最大运行时长 20 分钟）
- `agents.sandbox.timeout`：300s（沙箱生命周期，用于浏览器抓取）
- `schedules[0].cron`：`0 9 * * *`（每日 UTC 01:00 / 北京时间 09:00）

### 路由一览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/ai-trends/run` | POST | 启动流水线（SSE 流） |
| `/ai-trends/stop` | POST | 中止运行中的流水线 |
| `/ai-trends/latest` | GET | 获取最新报告 |
| `/ai-trends/history` | GET | 报告历史列表 |
| `/ai-trends/detail` | POST | 按 runId 获取指定报告 |
| `/ai-trends/delete` | POST | 按 runId 删除报告 |

`conversation_id` 通过 `makers-conversation-id` 请求头传递。

## 相关资源

- [Makers Agents 文档](https://cloud.tencent.com/document/product/1552/132759)
- [快速开始：Agent 开发](https://cloud.tencent.com/document/product/1552/132786)
- [Makers Models](https://cloud.tencent.com/document/product/1552/132748)

## 许可证

MIT
