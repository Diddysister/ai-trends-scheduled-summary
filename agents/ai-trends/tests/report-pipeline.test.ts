import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterAiItems } from '../_sources.js';
import { generateFallbackReport } from '../_report.js';
import { loadHistory, loadLatestReport, loadReport, saveReport } from '../_storage.js';
import { loadHistoryFromMemory, loadLatestReportFromMemory, loadReportFromMemory, saveReportToMemory } from '../_memory.js';
import type { TrendReport, TrendSourceItem } from '../_types.js';

class FakeMemory {
  messages: Array<{ content: string; metadata: Record<string, unknown>; createdAt: number }> = [];

  async appendMessage(input: { content: string; metadata?: Record<string, unknown> }) {
    this.messages.push({
      content: input.content,
      metadata: input.metadata || {},
      createdAt: this.messages.length + 1,
    });
    return `msg_${this.messages.length}`;
  }

  async getMessages(input: { limit?: number; order?: 'asc' | 'desc' }) {
    const items = [...this.messages];
    if (input.order === 'desc') items.reverse();
    return items.slice(0, input.limit || 20);
  }
}

async function run() {
  const { buildOpenAIClientOptions } = await import('../_model.js');
  const clientOptions = buildOpenAIClientOptions({
    AI_GATEWAY_API_KEY: 'test-key',
    AI_GATEWAY_BASE_URL: 'https://gateway.example.com/v1',
  });
  assert.equal(clientOptions.apiKey, 'test-key');
  assert.equal(clientOptions.baseURL, 'https://gateway.example.com/v1');

  const filtered = filterAiItems([
    { id: '1', title: 'OpenAI launches new AI agents SDK', url: 'https://example.com/ai' },
    { id: '2', title: 'Best sourdough bread recipes', url: 'https://example.com/bread' },
  ]);
  assert.deepEqual(filtered.map((item: TrendSourceItem) => item.id), ['1']);

  const rawHtml = '<a href="https:&#x2F;&#x2F;github.com&#x2F;TanStack&#x2F;router&#x2F;issues&#x2F;7383" rel="nofollow">https:&#x2F;&#x2F;github.com&#x2F;TanStack&#x2F;router&#x2F;issues&#x2F;7383</a>';
  const { cleanText, buildFallbackAiSummary } = await import('../_sources.js');
  const cleaned = cleanText(rawHtml);
  const fallbackSummary = buildFallbackAiSummary({
    id: 'html_1',
    title: 'TanStack Router issue discussion',
    url: 'https://example.com',
    summary: rawHtml,
    category: 'AI Infra',
  });
  assert.ok(!cleaned.includes('<a'));
  assert.ok(!cleaned.includes('&#x2F;'));
  assert.ok(!fallbackSummary.includes('<a'));
  assert.ok(!fallbackSummary.includes('建议结合源站内容继续核验'));

  const report = generateFallbackReport([
    {
      id: 'hn_1',
      source: 'Hacker News',
      title: 'LangGraph adds better agent orchestration',
      url: 'https://example.com/langgraph',
      category: 'AI Agent',
      score: 123,
    },
  ], 'run_test');
  assert.equal(report.runId, 'run_test');
  assert.equal(report.status, 'success');
  assert.match(report.reportMarkdown, /AI Agent/);
  assert.match(report.reportMarkdown, /https:\/\/example\.com\/langgraph/);
  assert.equal(report.trends.length, 1);

  const fakeContext = { store: new FakeMemory() };
  await saveReportToMemory(fakeContext, report);
  const memoryLatest = await loadLatestReportFromMemory(fakeContext);
  const memoryHistory = await loadHistoryFromMemory(fakeContext);
  const memoryDetail = await loadReportFromMemory(fakeContext, 'run_test');
  assert.equal(memoryLatest?.runId, 'run_test');
  assert.equal(memoryLatest?.storage, 'memory');
  assert.equal(memoryHistory[0]?.runId, 'run_test');
  assert.equal(memoryHistory[0]?.storage, 'memory');
  assert.equal((memoryDetail as TrendReport | null)?.reportMarkdown, report.reportMarkdown);
  assert.equal((memoryDetail as TrendReport | null)?.storage, 'memory');

  const { mergeItemLibrary } = await import('../_items.js');
  const mergeResult = mergeItemLibrary([
    {
      id: 'old_1',
      title: 'OpenAI agents launch',
      url: 'https://example.com/post?utm_source=x',
      score: 3,
      firstSeenAt: '2026-05-07T00:00:00Z',
      lastSeenAt: '2026-05-07T00:00:00Z',
      seenCount: 1,
      fingerprint: 'https://example.com/post',
    },
  ], [
    { id: 'new_same', title: 'OpenAI agents launch', url: 'https://example.com/post/', score: 9 },
    { id: 'new_2', title: 'Claude Platform on AWS', url: 'https://example.com/claude', score: 4 },
    { id: 'bad', title: 'Bad URL', url: 'javascript:alert(1)', score: 1 },
  ], '2026-05-08T00:00:00Z');
  assert.equal(mergeResult.newItemCount, 2);
  assert.equal(mergeResult.reusedItemCount, 1);
  assert.equal(mergeResult.reusedItems[0].seenCount, 2);
  assert.equal(mergeResult.reusedItems[0].score, 9);
  assert.equal(mergeResult.newItems[1].url, '');
  assert.deepEqual(mergeResult.reportItems.slice(0, 2).map(item => item.isNew), [true, true]);

  const dir = await mkdtemp(join(tmpdir(), 'ai-trends-node-'));
  try {
    report.newItemCount = 2;
    report.reusedItemCount = 1;
    report.itemIds = ['hn_1'];
    await saveReport(report, dir);
    assert.equal((await loadLatestReport(dir))?.runId, 'run_test');
    assert.equal((await loadReport('run_test', dir))?.reportMarkdown, report.reportMarkdown);
    assert.equal((await loadHistory(dir))[0]?.runId, 'run_test');
    assert.equal((await loadHistory(dir))[0]?.newItemCount, 2);
    assert.equal((await loadHistory(dir))[0]?.reusedItemCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
