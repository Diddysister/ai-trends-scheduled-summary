/**
 * GET /ai-trends/history — Cloud Function
 * Returns the list of historical reports.
 */

import { jsonResponse } from '../../_http';
import { getStore, loadHistory } from '../../_store';

export async function onRequestGet(context: any): Promise<Response> {
  const store = getStore(context);
  if (store) {
    const history = await loadHistory(store);
    if (history.length) return jsonResponse({ history });
  }
  return jsonResponse({ history: [] });
}
