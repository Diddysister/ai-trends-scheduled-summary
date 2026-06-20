/**
 * GET /ai-trends/health — Cloud Function
 * Simple health check endpoint.
 */

import { jsonResponse } from '../../_http';

export async function onRequestGet(context: any): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
