import type { TrendSourceItem } from './_types.js';

const TRACKING_PARAMS = new Set(['ref', 'source']);

export interface TrendLibraryItem extends TrendSourceItem {
  fingerprint?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  seenCount?: number;
  isNew?: boolean;
}

export interface MergeResult {
  items: TrendLibraryItem[];
  newItems: TrendLibraryItem[];
  reusedItems: TrendLibraryItem[];
  reportItems: TrendLibraryItem[];
  newItemCount: number;
  reusedItemCount: number;
}

export function normalizeUrl(value: unknown): string {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    [...url.searchParams.keys()].forEach(key => {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
    });
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeTitle(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function fingerprintItem(item: TrendSourceItem): string {
  const normalized = normalizeUrl(item.url);
  return normalized || `title:${normalizeTitle(item.title)}`;
}

function prepareNewItem(item: TrendSourceItem, fingerprint: string, now: string): TrendLibraryItem {
  return {
    ...item,
    url: normalizeUrl(item.url),
    fingerprint,
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    isNew: true,
  };
}

function updateExistingItem(existing: TrendLibraryItem, candidate: TrendSourceItem, now: string): TrendLibraryItem {
  return {
    ...existing,
    lastSeenAt: now,
    seenCount: (existing.seenCount || 1) + 1,
    score: Math.max(existing.score || 0, candidate.score || 0),
    summary: existing.summary || candidate.summary,
    aiSummary: existing.aiSummary || candidate.aiSummary,
    isNew: false,
  };
}

export function selectReportItems(newItems: TrendLibraryItem[], reusedItems: TrendLibraryItem[], limit = 30, library?: TrendLibraryItem[]): TrendLibraryItem[] {
  // Primary: items active in this run (new + reused)
  const active = [...newItems, ...reusedItems]
    .sort((a, b) => {
      if (Boolean(a.isNew) !== Boolean(b.isNew)) return a.isNew ? -1 : 1;
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')) || a.title.localeCompare(b.title);
    })
    .slice(0, limit);

  // Fill from library if active items not enough
  if (active.length < limit && library?.length) {
    const activeIds = new Set(active.map(i => i.fingerprint || fingerprintItem(i)));
    const filler = library
      .filter(i => !activeIds.has(i.fingerprint || fingerprintItem(i)))
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
      .slice(0, limit - active.length);
    return [...active, ...filler];
  }

  return active;
}

export function mergeItemLibrary(existingItems: TrendLibraryItem[], candidateItems: TrendSourceItem[], now: string, limit = 30): MergeResult {
  const library = new Map<string, TrendLibraryItem>();
  existingItems.forEach(item => {
    const fingerprint = item.fingerprint || fingerprintItem(item);
    if (fingerprint) library.set(fingerprint, { ...item, fingerprint, isNew: false });
  });

  const newItems: TrendLibraryItem[] = [];
  const reusedItems: TrendLibraryItem[] = [];

  candidateItems.forEach(candidate => {
    const fingerprint = fingerprintItem(candidate);
    if (!fingerprint) return;
    const existed = library.get(fingerprint);
    if (existed) {
      const updated = updateExistingItem(existed, candidate, now);
      library.set(fingerprint, updated);
      reusedItems.push(updated);
    } else {
      const created = prepareNewItem(candidate, fingerprint, now);
      library.set(fingerprint, created);
      newItems.push(created);
    }
  });

  const allLibraryItems = [...library.values()];

  return {
    items: allLibraryItems,
    newItems,
    reusedItems,
    reportItems: selectReportItems(newItems, reusedItems, limit, allLibraryItems),
    newItemCount: newItems.length,
    reusedItemCount: reusedItems.length,
  };
}
