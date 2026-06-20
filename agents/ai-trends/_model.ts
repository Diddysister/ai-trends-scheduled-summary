import { Agent, OpenAIChatCompletionsModel, run, tool } from '@openai/agents';
import { OpenAI } from 'openai';
import { z } from 'zod';

import type { TrendLibraryItem } from './_items.js';
import { buildFallbackContentTopics, generateFallbackReport, utcNow } from './_report.js';
import type {
  ContentTopic,
  ContentTopicPlannerOutput,
  CuratorOutput,
  FinishedReport,
  SummarizerOutput,
  TrendAnalysis,
  TrendGroup,
  TrendReport,
  TrendSourceItem,
} from './_types.js';
import {
  ComparePeriodsParamsSchema,
  GetHistoryItemsParamsSchema,
} from './_types.js';

// ── OpenAI client setup (via AI Gateway) ──────────────────────────

export function buildOpenAIClientOptions(env: Record<string, string | undefined>) {
  return {
    apiKey: env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY,
    baseURL: env.LLM_BASE_URL || env.AI_GATEWAY_BASE_URL || env.OPENAI_BASE_URL,
    timeout: 600000,
  };
}

function createModel(env: Record<string, string | undefined>): OpenAIChatCompletionsModel {
  const client = new OpenAI(buildOpenAIClientOptions(env));
  const modelName = env.LLM_MODEL || env.AI_GATEWAY_MODEL || '@makers/minimax-m2.7';
  return new OpenAIChatCompletionsModel(client as any, modelName);
}

// ── JSON parsing helpers ──────────────────────────────────────────

/**
 * Strip <think>...</think> reasoning tags that some models (DeepSeek, etc.)
 * emit in their output. These should never appear in final user-facing content.
 * Handles multiline content and multiple occurrences.
 */
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseJsonFromText<T>(text: string): T | null {
  // Strip thinking tags first — some models prepend <think>...</think> before JSON
  const cleaned = stripThinkingTags(text);

  // Helper: fix common JSON issues (trailing commas, etc.)
  function tryParse(json: string): T | null {
    // Direct attempt
    try { return JSON.parse(json) as T; } catch { /* continue */ }
    // Fix trailing commas: ,] or ,}
    const fixed = json
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/,\s*$/g, '');
    try { return JSON.parse(fixed) as T; } catch { /* continue */ }
    // Try to fix truncated JSON by closing brackets
    let attempt = fixed;
    const opens = (attempt.match(/[{[]/g) || []).length;
    const closes = (attempt.match(/[}\]]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      // Determine which bracket to close
      const lastOpen = Math.max(attempt.lastIndexOf('{'), attempt.lastIndexOf('['));
      attempt += attempt[lastOpen] === '{' ? '}' : ']';
    }
    try { return JSON.parse(attempt) as T; } catch { /* continue */ }
    return null;
  }

  // Try direct parse
  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Try extracting JSON block from markdown code fence
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const result = tryParse(fenceMatch[1]);
    if (result) return result;
  }
  // Try extracting first { ... } or [ ... ]
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const result = tryParse(objMatch[0]);
    if (result) return result;
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const result = tryParse(arrMatch[0]);
    if (result) return result;
  }
  // Last resort: find the first { and try to parse from there (handles preamble text)
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace > 0) {
    const result = tryParse(cleaned.slice(firstBrace));
    if (result) return result;
  }
  console.warn('[parseJson] all attempts failed, first 200 chars:', cleaned.slice(0, 200));
  return null;
}

// ── Tool definitions ──────────────────────────────────────────────

/**
 * Create a sandbox-powered fetch tool for Agents (用法 A).
 * Uses context.sandbox.commands.run('curl ...') to fetch URL content.
 * Compatible with ChatCompletions API via @openai/agents tool().
 */
function createSandboxFetchTool(sandbox: any) {
  return tool({
    name: 'fetch_url',
    description: '通过沙箱执行 curl 命令获取指定 URL 的网页内容（前 3000 字符）。当你需要了解某篇文章的详细内容以辅助趋势判断时使用此工具。',
    parameters: z.object({
      url: z.string().min(1).describe('要获取内容的完整 URL'),
    }),
    execute: async (input: { url: string }) => {
      console.log(`[fetch_url] Agent called fetch_url: ${input.url}`);
      try {
        const result = await sandbox.commands.run(
          `curl -sL --max-time 10 '${input.url.replace(/'/g, "'\\''")}' | head -c 3000`,
        );
        if (result?.exitCode && result.exitCode !== 0) {
          console.warn(`[fetch_url] curl failed: exit=${result.exitCode}`);
          return JSON.stringify({ error: `curl failed: ${result.stderr || 'unknown error'}` });
        }
        console.log(`[fetch_url] success, ${(result?.stdout || '').length} chars`);
        return result?.stdout || '(empty response)';
      } catch (err: any) {
        console.warn(`[fetch_url] error:`, err?.message);
        return JSON.stringify({ error: err?.message || 'fetch failed' });
      }
    },
  });
}

function createGetHistoryItemsTool(historyItems: TrendLibraryItem[]) {
  return tool({
    name: 'get_history_items',
    description: '检索历史 AI 资讯条目，用于对比当前与过去的趋势数据。返回指定时间范围内的历史条目。',
    parameters: GetHistoryItemsParamsSchema,
    execute: async (input: { maxItems?: number; daysBack?: number }) => {
      const maxItems = input.maxItems ?? 50;
      const daysBack = input.daysBack ?? 7;
      const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
      const filtered = historyItems
        .filter(item => (item.lastSeenAt || item.firstSeenAt || '') >= cutoff)
        .slice(0, maxItems);
      return JSON.stringify({
        count: filtered.length,
        items: filtered.map(item => ({
          id: item.id, title: item.title, category: item.category,
          source: item.source, seenCount: item.seenCount,
          firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
          isNew: item.isNew,
        })),
      });
    },
  });
}

function createComparePeriodsTool(
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
) {
  return tool({
    name: 'compare_periods',
    description: '对比当前周期与前一周期的趋势数据差异，按指定维度(count/categories/sources)进行分析。',
    parameters: ComparePeriodsParamsSchema,
    execute: async (input: { currentItemIds: string[]; metric: 'count' | 'categories' | 'sources' }) => {
      const currentSet = new Set(input.currentItemIds);
      const current = currentItems.filter(i => currentSet.has(i.id));
      const previous = historyItems.filter(i => !currentSet.has(i.id));

      const countBy = (items: TrendSourceItem[], key: 'category' | 'source') => {
        const map: Record<string, number> = {};
        for (const i of items) {
          const k = (key === 'category' ? i.category : i.source) || 'Other';
          map[k] = (map[k] || 0) + 1;
        }
        return map;
      };

      if (input.metric === 'count') {
        return JSON.stringify({ currentCount: current.length, previousCount: previous.length, delta: current.length - previous.length });
      }
      if (input.metric === 'categories') {
        return JSON.stringify({ current: countBy(current, 'category'), previous: countBy(previous, 'category') });
      }
      return JSON.stringify({ current: countBy(current, 'source'), previous: countBy(previous, 'source') });
    },
  });
}

// ── Agent factory functions (no outputType — prompt-guided JSON) ──

function createCuratorAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'CuratorAgent',
    instructions: [
      '你是 AI 趋势策展专家。从原始候选内容中筛选和分类。',
      '',
      '策展标准：',
      '1. 只保留与 AI Agent、LLM、多模态、开源模型、AI Infra、AI 产品直接相关的内容；',
      '2. 排除纯招聘帖、营销软文、重复/低质量内容；',
      '3. 为每条内容重新判定 category（AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry）；',
      '4. keep=true 表示保留，keep=false 表示丢弃；',
      '5. reason 简述保留或丢弃原因（中文）。',
      '',
      '你必须只输出 JSON，格式如下（不要包含其他文字）：',
      '{"items":[{"id":"...","title":"...","url":"...","category":"...","reason":"...","keep":true}],"droppedCount":5,"curatorNotes":"..."}',
    ].join('\n'),
    model: createModel(env),
  });
}

function createSummarizerAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'SummarizerAgent',
    instructions: [
      '你是 AI 资讯摘要专家。为每条 AI 相关资讯生成简洁的中文摘要。',
      '',
      '要求：',
      '1. 每条摘要 1-2 句话，提炼核心信息；',
      '2. 不要输出 HTML；',
      '3. 不要使用"建议结合源站内容继续核验"这类泛泛兜底；',
      '',
      '你必须只输出 JSON，格式如下（不要包含其他文字）：',
      '{"items":[{"id":"...","aiSummary":"..."}]}',
    ].join('\n'),
    model: createModel(env),
  });
}

function createAnalystAgent(
  env: Record<string, string | undefined>,
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
  sandbox?: unknown,
) {
  const tools: any[] = [
    createGetHistoryItemsTool(historyItems),
    createComparePeriodsTool(currentItems, historyItems),
  ];
  // Inject sandbox fetch tool if sandbox is available (用法 A: Agent 自主调用沙箱)
  if (sandbox && typeof (sandbox as any)?.commands?.run === 'function') {
    tools.push(createSandboxFetchTool(sandbox));
  }
  return new Agent({
    name: 'AnalystAgent',
    instructions: [
      '你是资深 AI 行业分析师。根据当前资讯和历史数据，对条目进行分类和重要性判断。',
      '',
      '分析要求：',
      '1. 将条目客观分为：',
      '   - new：本次首次采集到（isNew=true）',
      '   - active：连续多次出现（seenCount >= 2）',
      '   - single：仅出现一次但值得记录',
      '2. 按 category 对条目分组（AI Agent / LLM / Multimodal / Open Source Model / AI Infra / AI Industry）；',
      '3. 使用 get_history_items 工具获取历史数据，判断哪些是持续活跃的条目；',
      '4. 如果有 fetch_url 工具可用，选择 2-3 个你认为最重要的条目深入了解其内容，给出简短分析；',
      '5. 所有结论必须基于实际数据，不编造事实；',
      '6. 使用 fetch_url 时限制在最重要的 2-3 篇，不要对每条都调用；',
      '',
      '最终你必须只输出 JSON（不要包含其他文字），格式如下：',
      '{"categories":[{"name":"AI Agent","items":[{"id":"...","title":"...","status":"new|active|single","importance":"high|medium|low"}]}],"deepDives":[{"id":"...","title":"...","insight":"一句话分析"}],"keyInsight":"一段综合性核心洞察（不超过80字）","scores":[{"id":"...","score":82}]}',
      '',
      '其中 scores 是为每条保留的资讯打的综合推荐分（0-100），每条都必须有。',
    ].join('\n'),
    model: createModel(env),
    tools,
  });
}

function createWriterAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'WriterAgent',
    instructions: [
      '你是 AI 趋势报告撰写专家。基于结构化分析数据，撰写结构统一的中文 Markdown 报告。',
      '',
      '报告必须严格遵循以下结构（不要增减章节）：',
      '',
      '# AI 趋势日报',
      '',
      '## 今日要点',
      '（2-3 句核心发现，不超过 100 字，基于 keyInsight 字段扩写）',
      '',
      '## 热门动态',
      '（按 category 分组展示。每条格式：`- [标题](url) — 一句话摘要`）',
      '',
      '### AI Agent',
      '- [标题](url) — 摘要',
      '',
      '### LLM',
      '- [标题](url) — 摘要',
      '',
      '（其他 category 同理，没有条目的 category 省略）',
      '',
      '## 新出现',
      '（status=new 的条目，说明首次被采集到）',
      '',
      '## 持续活跃',
      '（status=active 的条目，说明连续多次出现，列出 seenCount）',
      '',
      '## 深度分析',
      '（基于 deepDives 字段，2-3 个被深入分析过的条目，附带 insight）',
      '',
      '## AI 自媒体选题',
      '（基于 contentTopics 字段，输出 3-5 个最值得今天做成 AI 自媒体内容的选题。每个选题包含：选题标题、来源、选题价值、切入角度、开头钩子、建议形式与目标受众。）',
      '',
      '写作要求：',
      '1. 所有来源链接使用 Markdown 超链接格式 [title](url)；',
      '2. 不编造来源，所有链接必须来自输入数据；',
      '3. 风格简洁专业，全文控制在 1500-3000 字；',
      '4. 直接输出 Markdown 内容，不要包裹在 JSON 或代码块中；',
      '5. 不要添加 "后续关注问题" 之类没有数据支撑的章节；',
      '6. "AI 自媒体选题" 章节必须来自 contentTopics，不能额外编造新闻来源。',
    ].join('\n'),
    model: createModel(env),
  });
}

function createTopicPlannerAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'TopicPlannerAgent',
    instructions: [
      '你是 AI 自媒体选题策划专家。你的任务是从当天已筛选和打分的 AI 资讯中，选出最值得做成内容的 3-5 个选题。',
      '',
      '选择标准：',
      '1. 新闻必须来自输入数据，sourceUrl/sourceTitle/newsIds 不能编造；',
      '2. 优先选择：影响面广、观点冲突强、有实操价值、有传播钩子、能引出行业判断的资讯；',
      '3. 不要只复述新闻，要给出适合自媒体表达的具体切入角度；',
      '4. 避免 5 个选题全部集中在同一细分方向，除非当天确实只有一个主题；',
      '5. 选题之间必须明显不同：不能只是同一角度换标题；同一新闻只允许对应一个选题；',
      '6. 如果高质量且不重复的选题不足 5 个，可以只输出 3 或 4 个，但不要低质量凑数；',
      '7. 每个选题需要能独立成稿，适合图文、短视频、长文或直播切片；',
      '8. 评分 score 表示自媒体选题价值，综合考虑热度、差异化、受众相关度和可讲述性。',
      '',
      '你必须只输出 JSON，格式如下（不要包含其他文字）：',
      '{"topics":[{"id":"topic_1","title":"...","sourceUrl":"...","sourceTitle":"...","newsIds":["..."],"score":88,"whyWorthMaking":"...","contentAngle":"...","hook":"...","targetAudience":"...","format":"..."}],"plannerNotes":"..."}',
      '',
      'topics 必须为 3-5 个；如果高质量不重复选题不足 5 个，输出 3 或 4 个即可。',
    ].join('\n'),
    model: createModel(env),
  });
}

// ── Prompt builders ───────────────────────────────────────────────

function buildItemsJson(items: TrendSourceItem[]): string {
  return JSON.stringify(items.slice(0, 30).map(item => ({
    id: item.id, title: item.title, url: item.url,
    source: item.source, category: item.category,
    sourceScore: item.score ?? 0, // 源站真实互动数据（HN upvotes / DevTo reactions / 0=无数据）
    summary: item.summary,
    isNew: item.isNew ?? false, seenCount: item.seenCount ?? 1,
  })));
}

function buildAnalystPrompt(items: TrendSourceItem[], noNewItems?: boolean): string {
  const lines = [
    '请分析以下 AI 资讯条目，按 category 分组并判断重要性。',
    '先使用 get_history_items 工具获取历史数据，判断哪些条目是持续活跃的。',
    '然后选择 2-3 个最重要的条目使用 fetch_url 深入了解。',
    '最后输出分析结果 JSON。',
    '',
    '【重要】你必须为每条保留的资讯打一个 0-100 的综合推荐分（scores 字段）：',
    '  - 热度（30%）：参考 sourceScore（源站真实互动数据）+ 话题讨论量。sourceScore=0 表示无互动数据，需依据标题/内容判断。',
    '  - 质量（40%）：原创深度内容、首发消息、技术突破 > 二手转述 > 营销软文。你已通过 fetch_url 阅读部分文章，请据此判断内容深度。',
    '  - 相关度（30%）：与 AI 核心话题（Agent/LLM/多模态/开源模型/Infra）的直接贴合程度。',
    '',
    '评分参考：',
    '  95-100: 划时代事件（如 GPT-5 发布）',
    '  80-94: 重大进展/深度首发（如新模型开源、重要论文）',
    '  65-79: 值得关注的行业动态/技术博客',
    '  50-64: 一般性资讯/二手转述',
    '  <50: 边缘相关（通常已被 Curator 过滤）',
    '',
  ];
  if (noNewItems) {
    lines.push('⚠️ 本次采集未发现新增内容，请重点分析持续活跃的条目。', '');
  }
  lines.push(`当前资讯条目：${buildItemsJson(items)}`);
  return lines.join('\n');
}

function buildWriterPrompt(
  items: TrendSourceItem[],
  analysis: TrendAnalysis | null,
  contentTopics: ContentTopic[],
  noNewItems?: boolean,
): string {
  const lines: string[] = [];
  if (analysis) {
    lines.push('请基于以下结构化分析数据，严格按照你的报告结构模板撰写报告：', '', `分析数据：${JSON.stringify(analysis)}`);
  } else {
    lines.push('分析师未能生成分析数据，请直接基于以下资讯条目按报告结构模板撰写：');
  }
  // Data source summary for the report header
  const sourceCounts = items.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
  const newCount = items.filter(i => i.isNew).length;
  lines.push('', `数据源统计：${JSON.stringify(sourceCounts)}，新增 ${newCount} 条`);
  lines.push('', '原始条目（含 url、category、aiSummary，用于填充报告链接和摘要）：', buildItemsJson(items));
  lines.push('', 'AI 自媒体选题（必须用于生成 "AI 自媒体选题" 章节）：', JSON.stringify(contentTopics));
  if (noNewItems) {
    lines.push('', '⚠️ 本次未发现新增内容。在"今日要点"中注明，"新出现"章节写"本次无新增条目"。');
  }
  return lines.join('\n');
}

function buildTopicPlannerPrompt(items: TrendSourceItem[], analysis: TrendAnalysis | null, noNewItems?: boolean): string {
  const lines = [
    '请从以下当天 AI 资讯中筛选最值得做成 AI 自媒体内容的 3-5 个选题，并为每个选题设计内容角度。',
    '',
    '当天资讯（含 url、category、aiSummary、score、isNew、seenCount）：',
    buildItemsJson(items),
  ];
  if (analysis) {
    lines.push('', `分析师输出：${JSON.stringify(analysis)}`);
  }
  if (noNewItems) {
    lines.push('', '本次采集没有新增资讯，请优先从仍持续活跃、分数高、可延展讨论的条目中选题，并在选题价值里说明这是持续关注信号。');
  }
  return lines.join('\n');
}

function normalizeContentTopics(rawTopics: ContentTopic[] | undefined, items: TrendSourceItem[]): ContentTopic[] {
  if (!rawTopics?.length) return [];
  const byId = new Map(items.map(item => [item.id, item]));
  const byUrl = new Map(items.map(item => [item.url, item]));
  const normalized: ContentTopic[] = [];
  const usedNewsIds = new Set<string>();
  const usedUrls = new Set<string>();
  const usedAngles = new Set<string>();
  const keyOf = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const topic of rawTopics) {
    const supportingItems = topic.newsIds
      .map(id => byId.get(id))
      .filter((item): item is TrendSourceItem => !!item);
    const primary = supportingItems[0] || byUrl.get(topic.sourceUrl);
    if (!primary) continue;
    const angleKey = keyOf(topic.contentAngle || topic.title);
    if (usedNewsIds.has(primary.id) || usedUrls.has(primary.url) || usedAngles.has(angleKey)) continue;
    usedNewsIds.add(primary.id);
    usedUrls.add(primary.url);
    usedAngles.add(angleKey);
    normalized.push({
      ...topic,
      id: topic.id || `topic_${normalized.length + 1}`,
      sourceUrl: primary.url,
      sourceTitle: primary.title,
      newsIds: supportingItems.length ? supportingItems.map(item => item.id) : [primary.id],
      score: Math.max(0, Math.min(100, Number(topic.score) || primary.score || 70)),
    });
    if (normalized.length >= 5) break;
  }
  return normalized;
}

// ── Report assembly helpers ───────────────────────────────────────

function buildTrendGroups(items: TrendSourceItem[]): TrendGroup[] {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || 'AI Industry';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }
  return Array.from(grouped.entries()).map(([category, catItems]) => ({
    category,
    summary: catItems.slice(0, 3).map(i => i.title).join('；'),
    count: catItems.length,
    items: catItems.slice(0, 5),
  }));
}

function assembleReportFromWriter(
  items: TrendSourceItem[],
  markdown: string,
  runId: string,
  trigger: string,
  contentTopics: ContentTopic[] = [],
): TrendReport {
  const firstLine = markdown.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || '';
  const summary = firstLine.slice(0, 120) || `${items.length} 条 AI 资讯趋势分析`;
  return {
    runId,
    status: 'success',
    trigger,
    generatedAt: utcNow(),
    itemCount: items.length,
    summary,
    reportMarkdown: markdown,
    trends: buildTrendGroups(items),
    items,
    contentTopics,
  };
}

function appendContentTopicsToMarkdown(lines: string[], topics: ContentTopic[]): void {
  lines.push('## AI 自媒体选题', '');
  if (!topics.length) {
    lines.push('暂无足够明确的选题候选。', '');
    return;
  }
  for (const [index, topic] of topics.slice(0, 5).entries()) {
    lines.push(
      `${index + 1}. **${topic.title}**`,
      `   - 来源：[${topic.sourceTitle}](${topic.sourceUrl})`,
      `   - 选题价值：${topic.whyWorthMaking}`,
      `   - 切入角度：${topic.contentAngle}`,
      `   - 开头钩子：${topic.hook}`,
      `   - 建议形式：${topic.format}；目标受众：${topic.targetAudience}`,
      '',
    );
  }
}

function ensureContentTopicsSection(markdown: string, topics: ContentTopic[]): string {
  if (markdown.includes('## AI 自媒体选题')) return markdown;
  const lines = [markdown.trim(), ''];
  appendContentTopicsToMarkdown(lines, topics);
  return lines.join('\n').trim();
}

function assembleReportFromAnalysis(
  items: TrendSourceItem[],
  analysis: TrendAnalysis,
  runId: string,
  trigger: string,
  contentTopics: ContentTopic[] = [],
): TrendReport {
  const lines = ['# AI 趋势日报', '', `> ${analysis.keyInsight}`, ''];

  // Group by category from analyst output
  if (analysis.categories?.length) {
    lines.push('## 热门动态', '');
    for (const cat of analysis.categories) {
      lines.push(`### ${cat.name}`, '');
      for (const entry of cat.items) {
        const item = items.find(i => i.id === entry.id);
        if (item) {
          lines.push(`- [${item.title}](${item.url}) — ${item.aiSummary || item.summary || entry.status}`);
        }
      }
      lines.push('');
    }
  }

  // Deep dives
  if (analysis.deepDives?.length) {
    lines.push('## 深度分析', '');
    for (const dd of analysis.deepDives) {
      const item = items.find(i => i.id === dd.id);
      const url = item?.url || '';
      lines.push(`- [${dd.title}](${url}) — ${dd.insight}`);
    }
    lines.push('');
  }

  appendContentTopicsToMarkdown(lines, contentTopics);

  const report = generateFallbackReport(items, runId, trigger, contentTopics);
  report.reportMarkdown = lines.join('\n');
  report.summary = analysis.keyInsight;
  report.agentWarning = 'Writer agent failed; report generated from analyst output';
  return report;
}

// ── Pipeline ──────────────────────────────────────────────────────

export type PipelineStage = 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'planner' | 'writer' | 'complete' | 'error';
export type PipelineStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineEvent {
  stage: PipelineStage;
  status: PipelineStatus;
  duration?: number;
  detail?: string;
}

/**
 * Generic SSE payload — either the legacy bare-shape stage event or a typed
 * StreamEvent (`{ type: 'stage' | 'items' | 'analysis' | 'token' | ... }`).
 * The handler is responsible for serializing this to a `data:` SSE frame.
 */
export type PipelineEmit = PipelineEvent | { type: string; [key: string]: unknown };

export interface PipelineInput {
  items: TrendSourceItem[];
  historyItems: TrendLibraryItem[];
  runId: string;
  trigger: string;
  env: Record<string, string | undefined>;
  noNewItems?: boolean;
  onProgress?: (event: PipelineEmit) => void;
  /** Sandbox instance (context.sandbox) — used to create sandbox tools for Agent */
  sandbox?: unknown;
  /** AbortSignal from the platform — when triggered, pipeline should stop ASAP */
  signal?: AbortSignal;
}

export interface PipelineStageResult {
  curatorOutput?: CuratorOutput;
  summarizerOutput?: SummarizerOutput;
  analystOutput?: TrendAnalysis;
  contentTopicOutput?: ContentTopicPlannerOutput;
  writerMarkdown?: string;
  failedStage?: string;
  error?: string;
}

/**
 * Run an agent in streaming mode, emitting `progress` events every few seconds
 * to keep the SSE connection alive (avoids CDN idle-timeout, typically 60s).
 *
 * If the stream fails with a transient error ("terminated", socket closed, etc.),
 * automatically retries once with a non-streaming call so the pipeline isn't
 * blocked by intermittent AI Gateway connection resets.
 *
 * The caller gets the same result shape as non-streaming `run()`.
 */
async function streamWithProgress(
  agent: Agent<unknown>,
  prompt: string,
  stage: string,
  emit: (event: PipelineEmit) => void,
  intervalMs = 8000,
  signal?: AbortSignal,
): Promise<{ finalOutput: string }> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let accumulated = '';
    let tokenCount = 0;
    let lastEmitAt = Date.now();

    const result = await run(agent, prompt, { stream: true, signal });

    for await (const event of result.toStream() as AsyncIterable<unknown>) {
      if (signal?.aborted) break;
      const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
      if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
        const delta = String(ev.data.delta || '');
        if (delta) {
          accumulated += delta;
          tokenCount++;
          // Emit progress periodically to keep the SSE alive and show activity.
          if (Date.now() - lastEmitAt >= intervalMs) {
            emit({ type: 'progress', stage, tokenCount, chars: accumulated.length });
            lastEmitAt = Date.now();
          }
        }
      }
    }

    // SDK's finalOutput is preferred (it strips internal framing if any).
    const finalOutput = (result as { finalOutput?: string }).finalOutput;
    const raw = typeof finalOutput === 'string' ? finalOutput : accumulated;
    return { finalOutput: stripThinkingTags(raw) };
  } catch (streamError) {
    // If aborted, rethrow immediately — don't retry
    if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
      throw streamError;
    }
    // Transient failures (AI Gateway connection reset, "terminated", socket closed)
    // → retry once without streaming. The pipeline keeps going.
    const msg = streamError instanceof Error ? streamError.message : String(streamError);
    console.warn(`[pipeline] ${stage} stream failed (${msg}), retrying without stream`);
    console.warn(`[pipeline] ${stage} full error:`, streamError);
    const retryResult = await run(agent, prompt, { signal });
    return { finalOutput: stripThinkingTags(String(retryResult.finalOutput || '')) };
  }
}

export async function runAgentPipeline(input: PipelineInput): Promise<{
  report: TrendReport;
  stages: PipelineStageResult;
}> {
  const { items, historyItems, runId, trigger, env, noNewItems, onProgress, sandbox, signal } = input;
  const stages: PipelineStageResult = {};
  const emit = onProgress ?? (() => {});

  // ── Stage 1+2: Curator & Summarizer (parallel) ─────────────────
  let curatedItems: TrendSourceItem[] = items;
  let enrichedItems: TrendSourceItem[] = items;

  try {
    const t0 = Date.now();
    console.log('[pipeline] Stage 1+2 (Curator+Summarizer) start');
    emit({ stage: 'curator', status: 'running' });
    emit({ stage: 'summarizer', status: 'running' });
    const curatorAgent = createCuratorAgent(env);
    const summarizerAgent = createSummarizerAgent(env);
    const itemsJson = buildItemsJson(items);

    const [curatorResult, summarizerResult] = await Promise.allSettled([
      streamWithProgress(curatorAgent, `请策展以下候选内容：\n${itemsJson}`, 'curator', emit, 8000, signal),
      streamWithProgress(summarizerAgent, `请为以下资讯生成中文摘要：\n${itemsJson}`, 'summarizer', emit, 8000, signal),
    ]);
    console.log(`[pipeline] Stage 1+2 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const stage12Duration = (Date.now() - t0) / 1000;

    // Process Curator
    if (curatorResult.status === 'fulfilled') {
      const raw = String(curatorResult.value.finalOutput || '');
      const parsed = parseJsonFromText<CuratorOutput>(raw);
      if (parsed?.items?.length) {
        stages.curatorOutput = parsed;
        const keepIds = new Set(parsed.items.filter(i => i.keep).map(i => i.id));
        const curatorMap = new Map(parsed.items.map(i => [i.id, i]));
        curatedItems = items
          .filter(item => keepIds.has(item.id))
          .map(item => {
            const curated = curatorMap.get(item.id);
            return curated ? { ...item, category: curated.category } : item;
          });
        if (!curatedItems.length) curatedItems = items;
        const detail = `kept ${curatedItems.length}/${items.length}`;
        console.log(`[pipeline] Curator: ${detail}`);
        // Log dropped items with reasons
        const dropped = parsed.items.filter(i => !i.keep);
        if (dropped.length) {
          console.log(`[pipeline] Curator dropped (explicit):`, dropped.map(i => `${i.id}: ${i.reason}`).join(' | '));
        }
        // Log items omitted entirely by curator (not mentioned in output)
        const mentionedIds = new Set(parsed.items.map(i => i.id));
        const omitted = items.filter(i => !mentionedIds.has(i.id));
        if (omitted.length) {
          console.log(`[pipeline] Curator omitted ${omitted.length} items (not in output):`, omitted.map(i => `[${i.source}] ${i.title?.slice(0, 30)}`).join(' | '));
        }
        emit({ stage: 'curator', status: 'done', duration: stage12Duration, detail });
        // Phase 2 of progressive content: emit kept items so frontend can
        // fade out the dropped ones. We send only the items that survived
        // curation; frontend computes droppedIds = previousIds − newIds.
        emit({ type: 'items', phase: 'curated', items: curatedItems });
      } else {
        console.log('[pipeline] Curator: output parse failed, using all items');
        emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      console.log('[pipeline] Curator failed:', curatorResult.reason);
      emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }

    // Process Summarizer
    if (summarizerResult.status === 'fulfilled') {
      const raw = String(summarizerResult.value.finalOutput || '');
      const parsed = parseJsonFromText<SummarizerOutput>(raw);
      if (parsed?.items?.length) {
        stages.summarizerOutput = parsed;
        const summaryMap = new Map(
          parsed.items.filter(i => i.id && i.aiSummary).map(i => [i.id, i.aiSummary]),
        );
        enrichedItems = curatedItems.map(item => ({
          ...item,
          aiSummary: summaryMap.get(item.id) || item.aiSummary,
        }));
        const detail = `${summaryMap.size} summaries`;
        console.log(`[pipeline] Summarizer: ${detail}`);
        emit({ stage: 'summarizer', status: 'done', duration: stage12Duration, detail });
        // Phase 3 of progressive content: emit items with aiSummary filled in.
        // Frontend merges by id and fades the summary text in.
        emit({ type: 'items', phase: 'summarized', items: enrichedItems });
      } else {
        enrichedItems = curatedItems;
        console.log('[pipeline] Summarizer: output parse failed, no summaries');
        emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      enrichedItems = curatedItems;
      console.log('[pipeline] Summarizer failed:', summarizerResult.reason);
      emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }
  } catch (error) {
    // If aborted, rethrow to skip remaining stages
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 1+2 aborted by user');
      throw error;
    }
    stages.failedStage = 'curator+summarizer';
    stages.error = error instanceof Error ? error.message : String(error);
    console.log('[pipeline] Stage 1+2 error:', stages.error);
  }

  // ── Abort check between stages ──
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 3');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 3: Analyst ────────────────────────────────────────────
  let analysis: TrendAnalysis | null = null;

  try {
    const t1 = Date.now();
    console.log('[pipeline] Stage 3 (Analyst) start');
    emit({ stage: 'analyst', status: 'running' });
    const analystAgent = createAnalystAgent(env, enrichedItems, historyItems, sandbox);
    const analystResult = await streamWithProgress(analystAgent, buildAnalystPrompt(enrichedItems, noNewItems), 'analyst', emit, 8000, signal);
    const raw = String(analystResult.finalOutput || '');
    const parsed = parseJsonFromText<TrendAnalysis>(raw);
    const d1 = +(((Date.now() - t1) / 1000).toFixed(1));
    if (parsed?.keyInsight || parsed?.categories?.length) {
      analysis = parsed;
      stages.analystOutput = analysis;
      // Write back Analyst scores (0-100) to enrichedItems for sorting and display.
      if (analysis.scores?.length) {
        const scoreMap = new Map(analysis.scores.map(s => [s.id, s.score]));
        enrichedItems = enrichedItems.map(item => {
          const aiScore = scoreMap.get(item.id);
          return aiScore != null ? { ...item, score: aiScore } : item;
        });
      }
      const categoryCount = analysis.categories?.length || 0;
      const deepDiveCount = analysis.deepDives?.length || 0;
      const detail = `${categoryCount} categories, ${deepDiveCount} deep dives`;
      console.log(`[pipeline] Analyst done (${d1}s): ${detail}`);
      emit({ stage: 'analyst', status: 'done', duration: d1, detail });
      // Phase 4 of progressive content: emit categories + scored items so
      // frontend can re-group, show keyInsight, and update displayed scores.
      emit({
        type: 'analysis',
        categories: analysis.categories || [],
        deepDives: analysis.deepDives || [],
        keyInsight: analysis.keyInsight,
      });
      // Re-emit items with Analyst scores so frontend LiveFeed picks up 0-100 scores.
      emit({ type: 'items', phase: 'summarized', items: enrichedItems });
    } else {
      console.log(`[pipeline] Analyst done (${d1}s): output parse failed`);
      console.log(`[pipeline] Analyst raw output (first 500 chars):`, raw.slice(0, 500));
      emit({ stage: 'analyst', status: 'failed', duration: d1, detail: 'parse failed' });
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 3 aborted by user');
      throw error;
    }
    stages.failedStage = stages.failedStage || 'analyst';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Analyst error:', stages.error);
    emit({ stage: 'analyst', status: 'failed', detail: stages.error });
  }

  // ── Abort check between stages ──
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 4');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 4: Topic Planner ─────────────────────────────────────
  let contentTopics: ContentTopic[] = [];

  try {
    const tPlanner = Date.now();
    console.log('[pipeline] Stage 4 (TopicPlanner) start');
    emit({ stage: 'planner', status: 'running' });
    const plannerAgent = createTopicPlannerAgent(env);
    const plannerResult = await streamWithProgress(
      plannerAgent,
      buildTopicPlannerPrompt(enrichedItems, analysis, noNewItems),
      'planner',
      emit,
      8000,
      signal,
    );
    const raw = String(plannerResult.finalOutput || '');
    const parsed = parseJsonFromText<ContentTopicPlannerOutput>(raw);
    const dPlanner = +(((Date.now() - tPlanner) / 1000).toFixed(1));
    const normalizedTopics = normalizeContentTopics(parsed?.topics, enrichedItems);
    const distinctSourceCount = new Set(enrichedItems.map(item => item.url || item.id)).size;
    const minTopicCount = Math.min(3, distinctSourceCount);
    if (normalizedTopics.length >= minTopicCount) {
      contentTopics = normalizedTopics;
      stages.contentTopicOutput = { topics: contentTopics, plannerNotes: parsed?.plannerNotes || '' };
      const detail = `${contentTopics.length} topics`;
      console.log(`[pipeline] TopicPlanner done (${dPlanner}s): ${detail}`);
      emit({ stage: 'planner', status: 'done', duration: dPlanner, detail });
      emit({ type: 'content_topics', topics: contentTopics });
    } else {
      contentTopics = buildFallbackContentTopics(enrichedItems);
      console.log(`[pipeline] TopicPlanner done (${dPlanner}s): output parse failed, using fallback topics`);
      emit({ stage: 'planner', status: 'failed', duration: dPlanner, detail: 'parse failed; fallback topics' });
      emit({ type: 'content_topics', topics: contentTopics });
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 4 aborted by user');
      throw error;
    }
    stages.failedStage = stages.failedStage || 'planner';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    contentTopics = buildFallbackContentTopics(enrichedItems);
    console.log('[pipeline] TopicPlanner error:', stages.error);
    emit({ stage: 'planner', status: 'failed', detail: stages.error });
    emit({ type: 'content_topics', topics: contentTopics });
  }

  // ── Abort check between stages ──
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 5');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 5: Writer (token-streaming with non-stream fallback) ───
  try {
    const t2 = Date.now();
    console.log('[pipeline] Stage 5 (Writer) start — streaming');
    emit({ stage: 'writer', status: 'running' });
    const writerAgent = createWriterAgent(env);
    const writerPrompt = buildWriterPrompt(enrichedItems, analysis, contentTopics, noNewItems);

    let markdown = '';

    try {
      // Primary path: stream tokens to the client for live-typing UX.
      let accumulated = '';
      let insideThink = false; // Track if we're inside <think>...</think>
      let thinkBuffer = '';    // Buffer to detect partial <think> or </think> tags
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const writerStreamResult = await run(writerAgent, writerPrompt, { stream: true, signal });

      for await (const event of writerStreamResult.toStream() as AsyncIterable<unknown>) {
        if (signal?.aborted) break;
        const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
        if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
          const delta = String(ev.data.delta || '');
          if (delta) {
            accumulated += delta;
            // Filter out <think>...</think> from live stream
            thinkBuffer += delta;
            if (insideThink) {
              const closeIdx = thinkBuffer.indexOf('</think>');
              if (closeIdx !== -1) {
                insideThink = false;
                const afterClose = thinkBuffer.slice(closeIdx + 8);
                thinkBuffer = '';
                if (afterClose) emit({ type: 'token', delta: afterClose });
              }
              // else: still inside think, swallow token
            } else {
              const openIdx = thinkBuffer.indexOf('<think>');
              if (openIdx !== -1) {
                insideThink = true;
                const beforeOpen = thinkBuffer.slice(0, openIdx);
                thinkBuffer = thinkBuffer.slice(openIdx + 7);
                if (beforeOpen) emit({ type: 'token', delta: beforeOpen });
              } else if (thinkBuffer.length > 7) {
                // Safe to flush — no partial <think> tag possible
                const safe = thinkBuffer.slice(0, -7);
                thinkBuffer = thinkBuffer.slice(-7);
                emit({ type: 'token', delta: safe });
              }
            }
          }
        }
      }
      // Flush remaining buffer (if not inside think)
      if (!insideThink && thinkBuffer) {
        emit({ type: 'token', delta: thinkBuffer });
      }

      const finalOutput = (writerStreamResult as { finalOutput?: string }).finalOutput;
      markdown = stripThinkingTags(
        (typeof finalOutput === 'string' && finalOutput.trim())
          ? finalOutput.trim()
          : accumulated.trim()
      );
    } catch (streamError) {
      // If aborted, rethrow — don't retry
      if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
        throw streamError;
      }
      // Fallback: if streaming fails ("terminated", connection reset, etc.),
      // retry without streaming. User won't see live-typing but still gets the report.
      const msg = streamError instanceof Error ? streamError.message : String(streamError);
      console.warn(`[pipeline] Writer stream failed (${msg}), retrying without stream`);
      console.warn(`[pipeline] Writer full error:`, streamError);
      const writerResult = await run(writerAgent, writerPrompt, { signal });
      markdown = stripThinkingTags(String(writerResult.finalOutput || '').trim());
    }

    const d2 = +(((Date.now() - t2) / 1000).toFixed(1));
    if (markdown && markdown.length > 50) {
      markdown = ensureContentTopicsSection(markdown, contentTopics);
      stages.writerMarkdown = markdown;
      const detail = `${markdown.length} chars`;
      console.log(`[pipeline] Writer done (${d2}s): ${detail}`);
      emit({ stage: 'writer', status: 'done', duration: d2, detail });
      return { report: assembleReportFromWriter(enrichedItems, markdown, runId, trigger, contentTopics), stages };
    }
    console.log(`[pipeline] Writer done (${d2}s): output too short`);
    emit({ stage: 'writer', status: 'failed', duration: d2, detail: 'output too short' });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 4 aborted by user');
      throw error;
    }
    stages.failedStage = stages.failedStage || 'writer';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Writer error:', stages.error);
    emit({ stage: 'writer', status: 'failed', detail: stages.error });
  }

  // ── Fallback from Analyst output ────────────────────────────────
  if (analysis) {
    console.log('[pipeline] Falling back to analyst-based report');
    return { report: assembleReportFromAnalysis(enrichedItems, analysis, runId, trigger, contentTopics), stages };
  }

  // ── Ultimate fallback ───────────────────────────────────────────
  console.log('[pipeline] All agents failed, using code-generated fallback');
  const fallback = generateFallbackReport(enrichedItems, runId, trigger, contentTopics.length ? contentTopics : undefined);
  fallback.agentWarning = stages.error || 'All agents failed';
  return { report: fallback, stages };
}
