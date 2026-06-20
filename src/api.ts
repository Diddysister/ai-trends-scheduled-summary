import type { HistoryEntry, PipelineEvent, StreamEvent, TrendReport } from './types';

const CONVERSATION_ID = 'ai-trends-dashboard';

export const API = {
  run: '/ai-trends/run',
  latest: '/ai-trends/latest',
  history: '/ai-trends/history',
  detail: '/ai-trends/detail',
  delete: '/ai-trends/delete',
  stop: '/ai-trends/stop',
} as const;

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.body?.error === 'string'
      ? data.body.error
      : typeof data?.error === 'string'
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (data?.body ?? data) as T;
}

export async function runReport(signal?: AbortSignal): Promise<TrendReport> {
  const res = await fetch(API.run, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'makers-conversation-id': CONVERSATION_ID,
    },
    body: JSON.stringify({
      conversation_id: CONVERSATION_ID,
      trigger: 'manual',
      sources: ['hackernews', 'devto', 'web'],
      limit: 30,
    }),
    signal,
  });
  return parseJson<TrendReport>(res);
}

export async function fetchLatest(): Promise<TrendReport> {
  const res = await fetch(API.latest, { method: 'GET' });
  return parseJson<TrendReport>(res);
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch(API.history, { method: 'GET' });
  const data = await parseJson<{ history: HistoryEntry[] }>(res);
  return data.history ?? [];
}

export async function fetchReportDetail(runId: string): Promise<TrendReport> {
  const res = await fetch(API.detail, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  });
  return parseJson<TrendReport>(res);
}

export interface SSECallbacks {
  /** Stage status transitions (existing PipelineBar). */
  onStage?: (event: PipelineEvent) => void;
  /** Progressive items snapshot at each phase boundary. */
  onItems?: (event: Extract<StreamEvent, { type: 'items' }>) => void;
  /** Analyst structured output (categories + keyInsight). */
  onAnalysis?: (event: Extract<StreamEvent, { type: 'analysis' }>) => void;
  /** Writer token streaming (Phase 2). */
  onToken?: (event: Extract<StreamEvent, { type: 'token' }>) => void;
}

export async function runReportSSE(
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<TrendReport | null> {
  const res = await fetch(API.run, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'makers-conversation-id': CONVERSATION_ID,
    },
    body: JSON.stringify({
      conversation_id: CONVERSATION_ID,
      trigger: 'manual',
      sources: ['hackernews', 'devto', 'web'],
      limit: 30,
    }),
    signal,
  });

  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalReport: TrendReport | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      try {
        const event = JSON.parse(payload) as StreamEvent | PipelineEvent;
        dispatchEvent(event, callbacks);
        // Capture the terminal report whichever shape it arrives in.
        if ('type' in event && event.type === 'complete' && event.report) {
          finalReport = event.report;
        } else if ('stage' in event && event.stage === 'complete' && event.report) {
          finalReport = event.report;
        }
      } catch {
        /* ignore malformed SSE lines */
      }
    }
  }

  return finalReport;
}

/**
 * Dispatch an SSE event to the right callback. Handles both the new
 * discriminated `StreamEvent` shape (`{ type: ... }`) and the legacy
 * bare-stage shape (`{ stage, status, ... }`) for backward compatibility.
 */
function dispatchEvent(event: StreamEvent | PipelineEvent, cb: SSECallbacks): void {
  if ('type' in event) {
    switch (event.type) {
      case 'stage':
        cb.onStage?.({ stage: event.stage, status: event.status, duration: event.duration, detail: event.detail });
        return;
      case 'items':
        cb.onItems?.(event);
        return;
      case 'analysis':
        cb.onAnalysis?.(event);
        return;
      case 'progress':
        // Progress events keep the SSE alive; no UI update needed.
        return;
      case 'token':
        cb.onToken?.(event);
        return;
      case 'complete':
      case 'error':
        // Terminal events handled by caller via finalReport capture.
        return;
    }
    return;
  }
  // Legacy bare-stage shape — forward as-is.
  cb.onStage?.(event);
}

export async function stopReport(): Promise<boolean> {
  try {
    const res = await fetch(API.stop, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: CONVERSATION_ID, conversation_id: CONVERSATION_ID }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteReport(runId: string): Promise<boolean> {
  try {
    const res = await fetch(API.delete, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
