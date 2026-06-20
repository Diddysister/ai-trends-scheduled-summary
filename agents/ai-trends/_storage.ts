import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HistoryEntry, TrendReport } from './_types.js';

export function defaultBaseDir(): string {
  return process.env.AI_TRENDS_DATA_DIR || 'data/ai-trends';
}

function withStorageMarker(report: TrendReport, storage: 'memory' | 'file-fallback'): TrendReport {
  return { ...report, storage };
}

async function ensureBase(baseDir = defaultBaseDir()): Promise<string> {
  await mkdir(join(baseDir, 'reports'), { recursive: true });
  return baseDir;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function saveReport(payload: TrendReport, baseDir = defaultBaseDir()): Promise<void> {
  const base = await ensureBase(baseDir);
  await writeFile(join(base, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(join(base, 'reports', `${payload.runId}.json`), JSON.stringify(payload, null, 2), 'utf8');

  const history = await loadHistory(base);
  const summary: HistoryEntry = {
    runId: payload.runId,
    status: payload.status,
    trigger: payload.trigger,
    generatedAt: payload.generatedAt,
    itemCount: payload.itemCount,
    newItemCount: payload.newItemCount,
    reusedItemCount: payload.reusedItemCount,
    summary: payload.summary,
    error: payload.error,
  };
  const next = [summary, ...history.filter(entry => entry.runId !== summary.runId)].slice(0, 30);
  await writeFile(join(base, 'history.json'), JSON.stringify(next, null, 2), 'utf8');
}

export async function loadLatestReport(baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const report = await readJson<TrendReport | null>(join(baseDir, 'latest.json'), null);
  return report ? withStorageMarker(report, 'file-fallback') : null;
}

export async function loadReport(runId: string, baseDir = defaultBaseDir()): Promise<TrendReport | null> {
  const safeRunId = runId.split(/[\\/]/).pop() || runId;
  const report = await readJson<TrendReport | null>(join(baseDir, 'reports', `${safeRunId}.json`), null);
  return report ? withStorageMarker(report, 'file-fallback') : null;
}

export async function loadHistory(baseDir = defaultBaseDir()): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(join(baseDir, 'history.json'), []);
}

export async function saveItemLibrary(items: unknown[], baseDir = defaultBaseDir()): Promise<void> {
  const base = await ensureBase(baseDir);
  await writeFile(join(base, 'items.json'), JSON.stringify(items, null, 2), 'utf8');
}

export async function loadItemLibrary<T = unknown>(baseDir = defaultBaseDir()): Promise<T[]> {
  return readJson<T[]>(join(baseDir, 'items.json'), []);
}
