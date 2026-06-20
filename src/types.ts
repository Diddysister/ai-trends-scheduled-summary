export interface TrendItem {
  id: string;
  source: string;
  title: string;
  url: string;
  score?: number;
  category?: string;
  summary?: string;
  aiSummary?: string;
  publishedAt?: string;
  fingerprint?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount?: number;
  isNew?: boolean;
}

export interface TrendGroup {
  category: string;
  summary: string;
  count: number;
  items: TrendItem[];
}

export interface TrendReport {
  runId?: string;
  status: 'success' | 'failed' | 'empty' | string;
  trigger?: string;
  generatedAt?: string;
  durationMs?: number;
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  itemIds?: string[];
  summary?: string;
  reportMarkdown: string;
  trends: TrendGroup[];
  items: TrendItem[];
  error?: string;
  agentWarning?: string;
  noNewItems?: boolean;
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

export interface PipelineEvent {
  stage: 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'writer' | 'complete' | 'error';
  status: 'running' | 'done' | 'failed' | 'skipped';
  duration?: number;
  detail?: string;
  report?: TrendReport;
}

// ── Streaming Event Schema ────────────────────────────────────────
// Mirrors `agents/ai-trends/_types.ts → StreamEvent`.

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
  | { type: 'stage'; stage: StageKey; status: StageStatus; duration?: number; detail?: string }
  | { type: 'items'; phase: ItemPhase; items: TrendItem[] }
  | { type: 'analysis'; categories: AnalystCategoryEvent[]; deepDives?: AnalystDeepDiveEvent[]; keyInsight?: string }
  | { type: 'progress'; stage: StageKey; tokenCount: number; chars: number }
  | { type: 'token'; delta: string }
  | { type: 'complete'; report: TrendReport }
  | { type: 'error'; detail: string };
