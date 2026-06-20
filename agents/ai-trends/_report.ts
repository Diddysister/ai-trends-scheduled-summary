import type { ContentTopic, TrendGroup, TrendReport, TrendSourceItem } from './_types.js';

export function utcNow(): string {
  return new Date().toISOString();
}

function formatReportTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function summarizeCategory(category: string, items: TrendSourceItem[]): string {
  const titles = items.slice(0, 3).map(item => item.title).filter(Boolean);
  if (!titles.length) return `${category} 方向有少量动态，建议继续观察。`;
  return `${category} 方向出现 ${items.length} 条相关动态，代表内容包括：${titles.join('；')}。`;
}

function normalizeTopicKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function topicTitleForItem(item: TrendSourceItem): string {
  const title = item.title.trim();
  const lower = title.toLowerCase();
  if (lower.includes('oauth') || lower.includes('mcp')) {
    return 'MCP 开始补安全课：AI Agent 的登录授权会成为下一个爆点吗？';
  }
  if (lower.includes('anthropic') && lower.includes('john jumper')) {
    return '诺奖级科学家加入 Anthropic：顶尖人才为什么正在涌向 AI 公司？';
  }
  if (title.includes('诺贝尔') || title.includes('奖得主') || lower.includes('nobel')) {
    return '诺贝尔奖得主下场做 AI：大模型公司的人才战升级了吗？';
  }
  if (lower.includes('boston dynamics') || lower.includes('hyundai')) {
    return '现代买下波士顿动力：具身智能会重新点燃机器人叙事吗？';
  }
  if (lower.includes('codegen') || lower.includes('coding') || lower.includes('autonomous coding')) {
    return '国产编程模型正面硬刚：AI Coding 真的要进入价格战了吗？';
  }
  if (lower.includes('ban') || title.includes('禁') || title.includes('限制')) {
    return 'AI 被学校和政策按下刹车：监管会不会改变下一波产品机会？';
  }
  if (lower.includes('robot')) {
    return '机器人又被 AI 推到台前：这次是真机会还是老叙事重启？';
  }
  if (lower.includes('agent')) {
    return 'AI Agent 又有新动作：这次离真正可用还有多远？';
  }
  return title.length > 44 ? `${title.slice(0, 42)}...这事为什么值得聊？` : `${title}，为什么值得今天聊？`;
}

export function buildFallbackContentTopics(items: TrendSourceItem[]): ContentTopic[] {
  const used = new Set<string>();
  const topics: ContentTopic[] = [];
  for (const item of [...items]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
  ) {
    const key = item.fingerprint || normalizeTopicKey(item.url || item.title);
    if (used.has(key)) continue;
    used.add(key);
    topics.push({
      id: `topic_${topics.length + 1}`,
      title: topicTitleForItem(item),
      sourceUrl: item.url,
      sourceTitle: item.title,
      newsIds: [item.id],
      score: Math.max(60, Math.min(100, item.score || 70)),
      whyWorthMaking: item.aiSummary || item.summary || '该动态与当天 AI 技术或产业讨论直接相关，适合快速转化为观点型内容。',
      contentAngle: topicTitleForItem(item),
      hook: '今天这条 AI 新闻，真正值得看的是它背后的信号。',
      targetAudience: 'AI 从业者、产品经理、技术创作者和关注 AI 趋势的读者',
      format: '图文快评或 60-90 秒短视频',
    });
    if (topics.length >= 4) break;
  }
  return topics;
}

function appendContentTopics(lines: string[], topics: ContentTopic[]): void {
  lines.push('## AI 自媒体选题', '');
  if (!topics.length) {
    lines.push('暂无足够明确的选题候选。', '');
    return;
  }
  for (const topic of topics.slice(0, 4)) {
    lines.push(
      `${topic.id.replace('topic_', '')}. **${topic.title}**`,
      `   - 来源：[${topic.sourceTitle}](${topic.sourceUrl})`,
      `   - 选题价值：${topic.whyWorthMaking}`,
      `   - 切入角度：${topic.contentAngle}`,
      `   - 开头钩子：${topic.hook}`,
      `   - 建议形式：${topic.format}；目标受众：${topic.targetAudience}`,
      '',
    );
  }
}

export function generateMarkdown(
  items: TrendSourceItem[],
  generatedAt: string,
  contentTopics: ContentTopic[] = buildFallbackContentTopics(items),
): { markdown: string; trends: TrendGroup[] } {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || 'AI Industry';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }

  const trends: TrendGroup[] = [];
  const lines = [
    '# AI 趋势日报',
    '',
    `生成时间：${formatReportTime(generatedAt)}`,
    `分析内容：${items.length} 条候选动态`,
    '',
    '## 今日趋势概览',
    '',
  ];

  if (!items.length) {
    lines.push('暂无满足条件的 AI 趋势内容。建议稍后重试或扩展数据源。', '');
    return { markdown: lines.join('\n'), trends };
  }

  Array.from(grouped.entries()).forEach(([category, categoryItems], index) => {
    const summary = summarizeCategory(category, categoryItems);
    trends.push({ category, summary, count: categoryItems.length, items: categoryItems.slice(0, 5) });
    lines.push(`${index + 1}. **${category}**：${summary}`);
  });

  lines.push('', '## 重点趋势', '');
  for (const trend of trends) {
    lines.push(`### ${trend.category}`, '', trend.summary, '', '代表来源：');
    for (const item of trend.items) {
      lines.push(`- [${item.title}](${item.url}) — ${item.source || 'Unknown'} · score ${item.score || 0}`);
    }
    lines.push('');
  }

  appendContentTopics(lines, contentTopics);

  lines.push(
    '## 后续关注问题',
    '',
    '- 哪些 Agent 工具链开始获得真实生产用户？',
    '- 多模态能力是否从演示进入稳定业务流程？',
    '- 开源模型与闭源模型在成本、性能和可控性上的差距是否缩小？',
    '',
    '## 说明',
    '',
    '本报告由模板从公开技术信息源自动生成，建议对关键事实继续核验原文链接。',
  );

  return { markdown: lines.join('\n'), trends };
}

export function generateFallbackReport(
  items: TrendSourceItem[],
  runId: string,
  trigger = 'manual',
  contentTopics = buildFallbackContentTopics(items),
): TrendReport {
  const generatedAt = utcNow();
  const { markdown, trends } = generateMarkdown(items, generatedAt, contentTopics);
  return {
    runId,
    status: 'success',
    trigger,
    generatedAt,
    itemCount: items.length,
    summary: trends[0]?.summary || '暂无满足条件的 AI 趋势内容。',
    reportMarkdown: markdown,
    trends,
    items,
    contentTopics,
  };
}

// buildAgentPrompt removed — prompt logic moved to _model.ts agent instructions
