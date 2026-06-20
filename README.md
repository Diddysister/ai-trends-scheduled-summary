# AI Trends Scheduled Summary

> A scheduled AI news aggregation agent built with the OpenAI Agents SDK on EdgeOne Makers — automatically collects, curates, scores, and generates daily trend reports from multiple sources.

**Framework:** OpenAI Agents SDK · **Category:** Scheduled · **Language:** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=ai-trends-scheduled-summary&from=within&fromAgent=1&agentLang=typescript)

## Overview

AI Trends Scheduled Summary runs a 4-agent pipeline on a daily cron schedule (or manual trigger) to collect AI industry news from Hacker News, Dev.to, and web sources, then produces a curated Markdown trend report. The entire pipeline streams progress via SSE so users can watch items being fetched, filtered, scored, and written in real time.

- **Multi-source collection** — pulls from Hacker News, Dev.to, and configurable web sources (via sandbox browser scraping)
- **4-agent pipeline** — Curator (filter) + Summarizer (summarize) run in parallel, followed by Analyst (score + classify) and Writer (Markdown report)
- **Real-time SSE streaming** — progressive content disclosure from fetch through final report, with token-level Writer streaming
- **Cross-run deduplication** — fingerprint-based item library tracks `seenCount`, `firstSeenAt`, `lastSeenAt` across scheduled runs
- **Comprehensive scoring** — Analyst assigns 0–100 scores based on source engagement, content quality, and AI-relevance

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Model gateway API key. Use your **Makers Models API Key**, or any OpenAI-compatible provider key. |
| `AI_GATEWAY_BASE_URL` | Yes | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`. |
| `AI_GATEWAY_MODEL` | No | Model ID. Defaults to `@makers/minimax-m2.7`. |

> This template follows the **OpenAI-compatible** standard — you can point these variables at Makers Models or any other compatible gateway / provider.

### How to get `AI_GATEWAY_API_KEY`

1. Open the [Makers Console](https://edgeone.ai/makers/new?s_url=https://console.tencentcloud.com/edgeone/makers).
2. Sign in and enable Makers.
3. Go to **Makers → Models → API Key** and create a key.
4. Copy it into `AI_GATEWAY_API_KEY` (set `AI_GATEWAY_BASE_URL` to `https://ai-gateway.edgeone.link/v1`).

Built-in models (`@makers/deepseek-v4-flash`, `@makers/hy3-preview`, `@makers/minimax-m2.7`) are free and rate-limited — great for prototyping. For production, bind your own provider key (BYOK) in the console.

### Provider fallbacks

The code reads environment variables with the following priority chain:

```
LLM_API_KEY → AI_GATEWAY_API_KEY → OPENAI_API_KEY
LLM_BASE_URL → AI_GATEWAY_BASE_URL → OPENAI_BASE_URL
LLM_MODEL → AI_GATEWAY_MODEL → @makers/minimax-m2.7
```

You can set any of these depending on your provider preference.

## Local Development

**Prerequisites:** Node.js ≥ 18, npm

```bash
npm install
cp .env.example .env
edgeone makers dev
```

Open `http://localhost:8080/agent-metrics` for the local observability panel.

## Project Structure

```text
ai-trends-scheduled-summary/
├── agents/
│   └── ai-trends/
│       ├── run.ts              # /ai-trends/run — main pipeline entry (SSE stream)
│       ├── stop.ts             # /ai-trends/stop — abort a running pipeline
│       ├── _model.ts           # 4-agent definitions, prompts, streaming logic
│       ├── _sources.ts         # Data collection (HN, Dev.to, sandbox browser)
│       ├── _items.ts           # Item library: fingerprinting, merge, dedup
│       ├── _memory.ts          # Platform store persistence (reports + items)
│       ├── _storage.ts         # File-system fallback persistence
│       ├── _report.ts          # Report assembly helpers
│       ├── _http.ts            # Request/response utilities
│       └── _types.ts           # Shared Zod schemas & TypeScript types
├── cloud-functions/
│   └── ai-trends/
│       ├── latest/index.ts     # GET /ai-trends/latest
│       ├── history/index.ts    # GET /ai-trends/history
│       ├── detail/index.ts     # POST /ai-trends/detail
│       ├── delete/index.ts     # POST /ai-trends/delete
│       └── health/index.ts     # GET /ai-trends/health
├── src/                        # Frontend (React + Vite)
│   ├── App.tsx                 # Main UI: LiveFeed, PipelineBar, ReportDrawer
│   ├── api.ts                  # SSE client & REST helpers
│   ├── i18n.tsx                # Chinese/English i18n
│   ├── MarkdownReport.tsx      # Markdown renderer
│   ├── reportModel.ts          # Frontend report normalization
│   └── types.ts                # Frontend type definitions
├── edgeone.json                # Agent runtime & schedule configuration
└── package.json
```

> Files prefixed with `_` are private modules — not exposed as public routes by EdgeOne.

## How It Works

The agent runs as a **session-mode** runtime under `agents/`. Requests sharing the same `conversation_id` are routed to the same instance (and sandbox, when available).

### Pipeline Flow

1. **Trigger** — either via cron schedule (`0 9 * * *` daily) or manual POST to `/ai-trends/run`. The request includes `sources` (default: `hackernews`, `devto`, `web`) and `limit`.

2. **Fetch & Merge** — collects candidates from configured sources. Hacker News and Dev.to use public APIs; web sources use the sandbox browser (`context.sandbox.browser.goto` + `evaluate`) for JS-rendered pages. Candidates are deduplicated against the item library using URL/title fingerprints.

3. **Curator + Summarizer (parallel)** — two agents run concurrently via `Promise.allSettled`:
   - **Curator** filters irrelevant items, assigns categories (`AI Agent`, `LLM`, `Multimodal`, etc.), and decides keep/drop.
   - **Summarizer** generates 1–2 sentence Chinese summaries for each item.

4. **Analyst** — scores each item 0–100 (weighted: 40% quality, 30% heat, 30% relevance), groups by category, identifies new/active/single status, and optionally deep-dives into 2–3 top articles via `fetch_url` sandbox tool.

5. **Writer (token-streaming)** — generates a structured Markdown report streamed token-by-token to the client. Filters `<think>` tags in real time. Falls back to non-streaming retry on connection failure.

6. **Persist** — the final report is saved to `context.store` (platform memory). If unavailable, falls back to file-system storage.

### SSE Streaming Protocol

The `/ai-trends/run` endpoint returns an SSE stream with typed events:

| Event type | Purpose |
|-----------|---------|
| `stage` | Pipeline stage status transitions (`running` / `done` / `failed`) |
| `items` | Progressive content snapshots (`fetched` → `curated` → `summarized`) |
| `analysis` | Analyst output (categories, scores, keyInsight) |
| `progress` | Keepalive during long LLM calls (emitted every 8s) |
| `token` | Writer Markdown tokens for live-typing UX |
| `complete` | Terminal event with the full `TrendReport` payload |

### Key Design Decisions

- **Graceful degradation** — if Writer fails, report is assembled from Analyst output; if Analyst fails, a code-generated fallback is used.
- **AbortSignal** — threaded through all stages; users can stop generation mid-pipeline.
- **Conversation-scoped storage** — reports and item library are stored per conversation via `context.store.appendMessage` / `getMessages`.

### Runtime Configuration

From `edgeone.json`:
- `agents.timeout`: 1200s (20 min max pipeline duration)
- `agent.sandbox.timeout`: 300s (sandbox lifetime for browser scraping)
- `schedules[0].cron`: `0 9 * * *` (daily at 01:00 UTC)

### Route Summary

| Route | Method | Description |
|-------|--------|-------------|
| `/ai-trends/run` | POST | Start pipeline (SSE stream) |
| `/ai-trends/stop` | POST | Abort running pipeline |
| `/ai-trends/latest` | GET | Latest report |
| `/ai-trends/history` | GET | Report history list |
| `/ai-trends/detail` | POST | Specific report by runId |
| `/ai-trends/delete` | POST | Delete report by runId |

The `conversation_id` is passed via the `makers-conversation-id` request header.

## Resources

- [Makers Agents Documentation](https://pages.edgeone.ai/document/agents)
- [Quick Start: Agent Development](https://pages.edgeone.ai/document/agents-quick-start)
- [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT
