import type { TrendGroup, TrendReport, TrendSourceItem } from './_types.js';

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

export function generateMarkdown(items: TrendSourceItem[], generatedAt: string): { markdown: string; trends: TrendGroup[] } {
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

export function generateFallbackReport(items: TrendSourceItem[], runId: string, trigger = 'manual'): TrendReport {
  const generatedAt = utcNow();
  const { markdown, trends } = generateMarkdown(items, generatedAt);
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
  };
}

// buildAgentPrompt removed — prompt logic moved to _model.ts agent instructions
