import type { TrendReport } from './types';

export const EMPTY_REPORT: TrendReport = {
  status: 'empty',
  summary: '还没有生成过 AI 趋势报告。',
  reportMarkdown: '# AI 趋势日报\n\n点击“立即生成”开始采集 Hacker News 与 Dev.to 的 AI 动态。',
  trends: [],
  items: [],
};

export function normalizeReport(input: Partial<TrendReport> | null | undefined): TrendReport {
  return {
    ...EMPTY_REPORT,
    ...(input ?? {}),
    status: input?.status ?? EMPTY_REPORT.status,
    reportMarkdown: input?.reportMarkdown ?? EMPTY_REPORT.reportMarkdown,
    trends: Array.isArray(input?.trends) ? input.trends : [],
    items: Array.isArray(input?.items) ? input.items : [],
  };
}
