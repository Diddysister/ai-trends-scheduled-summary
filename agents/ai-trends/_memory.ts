import type { HistoryEntry, TrendReport, TrendSourceItem } from './_types.js';

const REPORT_CONVERSATION_ID = 'ai-trends-reports';
const ITEM_CONVERSATION_ID = 'ai-trends-items';
const REPORT_KIND = 'ai_trends_report';
const ITEM_SNAPSHOT_KIND = 'ai_trends_item_snapshot';

interface MemoryMessage {
  messageId?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

interface AgentMemoryLike {
  appendMessage(input: {
    conversationId: string;
    role: 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<string>;
  getMessages(input: {
    conversationId: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<MemoryMessage[]>;
  deleteMessage?(input: { conversationId: string; messageId: string }): Promise<void>;
  clearMessages?(input: { conversationId: string }): Promise<void>;
}

function getMemory(context: unknown): AgentMemoryLike | null {
  const memory = (context as { store?: AgentMemoryLike } | null)?.store;
  if (!memory || typeof memory.appendMessage !== 'function' || typeof memory.getMessages !== 'function') return null;
  return memory;
}

function parseReportMessage(message: MemoryMessage): TrendReport | null {
  if (message.metadata?.kind !== REPORT_KIND) return null;
  const content = message.content;
  if (typeof content === 'object' && content !== null) return content as TrendReport;
  try {
    const parsed = JSON.parse(String(content));
    return parsed && typeof parsed === 'object' ? parsed as TrendReport : null;
  } catch {
    return null;
  }
}

function withStorageMarker(report: TrendReport, storage: 'memory' = 'memory'): TrendReport {
  return { ...report, storage };
}

function toHistoryEntry(report: TrendReport): HistoryEntry {
  return {
    runId: report.runId,
    status: report.status,
    trigger: report.trigger,
    generatedAt: report.generatedAt,
    itemCount: report.itemCount,
    newItemCount: report.newItemCount,
    reusedItemCount: report.reusedItemCount,
    summary: report.summary,
    error: report.error,
    storage: report.storage ?? 'memory',
  };
}

// ── Report persistence (unchanged) ──

export async function saveReportToMemory(context: unknown, report: TrendReport): Promise<boolean> {
  const memory = getMemory(context);
  if (!memory) return false;
  await memory.appendMessage({
    conversationId: REPORT_CONVERSATION_ID,
    role: 'assistant',
    content: JSON.stringify(report),
    metadata: {
      kind: REPORT_KIND,
      runId: report.runId,
      status: report.status,
      summary: report.summary,
      itemCount: report.itemCount,
      trigger: report.trigger,
    },
  });
  return true;
}

async function loadReports(context: unknown, limit = 30): Promise<TrendReport[]> {
  const memory = getMemory(context);
  if (!memory) return [];
  try {
    const safeLimit = Math.min(limit, 100);
    const messages = await memory.getMessages({ conversationId: REPORT_CONVERSATION_ID, limit: safeLimit, order: 'desc' });
    const seen = new Set<string>();
    const reports: TrendReport[] = [];
    for (const message of messages) {
      const report = parseReportMessage(message);
      if (!report) continue;
      if (report.runId && seen.has(report.runId)) continue;
      if (report.runId) seen.add(report.runId);
      reports.push(withStorageMarker(report));
    }
    return reports;
  } catch {
    return [];
  }
}

export async function loadLatestReportFromMemory(context: unknown): Promise<TrendReport | null> {
  const reports = await loadReports(context, 1);
  return reports[0] ?? null;
}

export async function loadHistoryFromMemory(context: unknown): Promise<HistoryEntry[]> {
  const reports = await loadReports(context, 30);
  return reports.map(toHistoryEntry);
}

export async function loadReportFromMemory(context: unknown, runId: string): Promise<TrendReport | null> {
  const reports = await loadReports(context, 100);
  return reports.find(report => report.runId === runId) ?? null;
}

// ── Item library persistence (snapshot strategy) ──

/**
 * Save the full item library as a single snapshot message.
 * Each run appends ONE message containing the entire items array.
 * Old snapshots are cleaned up when count exceeds threshold.
 */
export async function saveItemsToMemory(context: unknown, items: TrendSourceItem[]): Promise<boolean> {
  const memory = getMemory(context);
  if (!memory) return false;
  await memory.appendMessage({
    conversationId: ITEM_CONVERSATION_ID,
    role: 'tool',
    content: JSON.stringify(items),
    metadata: {
      kind: ITEM_SNAPSHOT_KIND,
      itemCount: items.length,
      savedAt: new Date().toISOString(),
    },
  });
  return true;
}

/**
 * Load the item library from the latest snapshot message.
 * Reads only 1 message (the most recent snapshot), parses the full array.
 */
export async function loadItemsFromMemory(context: unknown): Promise<TrendSourceItem[]> {
  const memory = getMemory(context);
  if (!memory) return [];
  try {
    const messages = await memory.getMessages({ conversationId: ITEM_CONVERSATION_ID, limit: 5, order: 'desc' });
    // Find the latest snapshot message
    for (const message of messages) {
      if (message.metadata?.kind !== ITEM_SNAPSHOT_KIND) continue;
      try {
        const items = JSON.parse(String(message.content || '[]'));
        if (Array.isArray(items)) return items;
      } catch {
        continue;
      }
    }
    return [];
  } catch {
    return [];
  }
}

// ── Delete report by runId ──

export async function deleteReportFromMemory(context: unknown, runId: string): Promise<boolean> {
  const memory = getMemory(context);
  if (!memory || typeof memory.deleteMessage !== 'function') return false;
  try {
    const safeLimit = 100;
    const messages = await memory.getMessages({ conversationId: REPORT_CONVERSATION_ID, limit: safeLimit, order: 'desc' });
    for (const message of messages) {
      if (message.metadata?.kind !== REPORT_KIND) continue;
      if (message.metadata?.runId !== runId) continue;
      if (!message.messageId) continue;
      await memory.deleteMessage({ conversationId: REPORT_CONVERSATION_ID, messageId: message.messageId });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
