import { z } from 'zod';

export interface TrendSourceItem {
  id: string;
  source?: string;
  title: string;
  url: string;
  score?: number;
  publishedAt?: string;
  summary?: string;
  aiSummary?: string;
  fingerprint?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount?: number;
  isNew?: boolean;
  category?: string;
}

export interface TrendGroup {
  category: string;
  summary: string;
  count: number;
  items: TrendSourceItem[];
}

export interface TrendReport {
  runId: string;
  status: 'success' | 'failed' | 'empty' | string;
  trigger?: string;
  generatedAt: string;
  durationMs?: number;
  itemCount: number;
  newItemCount?: number;
  reusedItemCount?: number;
  itemIds?: string[];
  summary: string;
  reportMarkdown: string;
  trends: TrendGroup[];
  items: TrendSourceItem[];
  sources?: string[];
  schedule?: unknown;
  noNewItems?: boolean;
  error?: string;
  agentWarning?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

export interface HistoryEntry {
  runId?: string;
  status?: string;
  trigger?: string;
  generatedAt?: string;
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary?: string;
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

// ── Agent I/O Schemas (Zod) ───────────────────────────────────────

// Agent 1: Curator output
export const CuratedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string().optional(),
  category: z.string().describe('AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry'),
  reason: z.string().describe('Brief reason for keep/drop decision (Chinese)'),
  keep: z.boolean().describe('true to include, false to drop'),
});
export type CuratedItem = z.infer<typeof CuratedItemSchema>;

export const CuratorOutputSchema = z.object({
  items: z.array(CuratedItemSchema),
  droppedCount: z.number(),
  curatorNotes: z.string().describe('Brief summary of curation decisions'),
});
export type CuratorOutput = z.infer<typeof CuratorOutputSchema>;

// Agent 2: Summarizer output
export const SummarizedItemSchema = z.object({
  id: z.string(),
  aiSummary: z.string().describe('1-2 sentence Chinese summary'),
});
export type SummarizedItem = z.infer<typeof SummarizedItemSchema>;

export const SummarizerOutputSchema = z.object({
  items: z.array(SummarizedItemSchema),
});
export type SummarizerOutput = z.infer<typeof SummarizerOutputSchema>;

// Agent 3: Analyst output
export const AnalystCategoryItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['new', 'active', 'single']),
  importance: z.enum(['high', 'medium', 'low']),
});

export const AnalystCategorySchema = z.object({
  name: z.string(),
  items: z.array(AnalystCategoryItemSchema),
});

export const DeepDiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  insight: z.string().describe('One-sentence analysis from fetch_url'),
});

export const TrendAnalysisSchema = z.object({
  categories: z.array(AnalystCategorySchema),
  deepDives: z.array(DeepDiveSchema).optional(),
  keyInsight: z.string().describe('Core insight in under 80 chars (Chinese)'),
  scores: z.array(z.object({
    id: z.string(),
    score: z.number().describe('0-100 综合推荐分'),
  })).describe('每条保留资讯的综合推荐评分（0-100）'),
});
export type TrendAnalysis = z.infer<typeof TrendAnalysisSchema>;

// Keep legacy TrendEntry for backward compat with report assembly
export const TrendEntrySchema = z.object({
  trendName: z.string(),
  status: z.enum(['new', 'rising', 'stable', 'cooling']),
  description: z.string().describe('2-3 sentence Chinese description'),
  impact: z.enum(['high', 'medium', 'low']),
  relatedItemIds: z.array(z.string()).describe('IDs of items supporting this trend'),
});
export type TrendEntry = z.infer<typeof TrendEntrySchema>;

// Agent 4: Writer output
export const FinishedReportSchema = z.object({
  reportMarkdown: z.string().describe('Full Markdown trend report'),
  summary: z.string().describe('One-line summary for metadata'),
  followUpQuestions: z.array(z.string()).describe('2-5 follow-up questions worth tracking'),
});
export type FinishedReport = z.infer<typeof FinishedReportSchema>;

// Tool parameter schemas
export const GetHistoryItemsParamsSchema = z.object({
  maxItems: z.number().optional().describe('Maximum historical items to retrieve (default 50)'),
  daysBack: z.number().optional().describe('How many days back to look (default 7)'),
});

export const ComparePeriodsParamsSchema = z.object({
  currentItemIds: z.array(z.string()).describe('IDs of items in the current period'),
  metric: z.enum(['count', 'categories', 'sources']).describe('Dimension to compare'),
});

// ── Streaming Event Schema ────────────────────────────────────────
// Discriminated union for SSE pipeline events. Backend emits these via
// `data: ${JSON.stringify(event)}\n\n` — frontend dispatches by `type`.

export type StageKey = 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'writer';
export type StageStatus = 'running' | 'done' | 'failed' | 'skipped';
export type ItemPhase = 'fetched' | 'curated' | 'summarized';

export interface AnalystCategoryEvent {
  name: string;
  items: Array<{ id: string; title: string; status: 'new' | 'active' | 'single'; importance: 'high' | 'medium' | 'low' }>;
}

export interface AnalystDeepDiveEvent {
  id: string;
  title: string;
  insight: string;
}

export type StreamEvent =
  // Stage status transitions (kept compatible with old PipelineEvent shape)
  | { type: 'stage'; stage: StageKey; status: StageStatus; duration?: number; detail?: string }
  // Progressive content snapshots emitted at stage boundaries
  | { type: 'items'; phase: ItemPhase; items: TrendSourceItem[] }
  // Analyst structured output
  | { type: 'analysis'; categories: AnalystCategoryEvent[]; deepDives?: AnalystDeepDiveEvent[]; keyInsight?: string }
  // In-progress streaming indicator (emitted every few seconds during long LLM calls)
  | { type: 'progress'; stage: StageKey; tokenCount: number; chars: number }
  // Writer token streaming (Phase 2 — declared now, emitted later)
  | { type: 'token'; delta: string }
  // Terminal events
  | { type: 'complete'; report: TrendReport }
  | { type: 'error'; detail: string };

// Backward-compat alias (existing code path uses bare-shape events without `type`)
export type PipelineEvent =
  | { stage: StageKey | 'complete' | 'error'; status: StageStatus; duration?: number; detail?: string; report?: TrendReport }
  | StreamEvent;
