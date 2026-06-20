import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';

const translations = {
  zh: {
    // Header
    eyebrow: 'AI Trends Monitor',
    title: 'AI 热点汇总',
    subtitle: '按计划采集公开技术资讯，沉淀为可追溯的 AI 趋势报告。',
    scheduleHint: '每日 9:00 自动采集',
    generate: '手动生成',
    generating: '生成中...',
    stop: '停止',

    // Stats bar
    lastGenerated: '最近生成',
    items: '条资讯',
    topics: '个主题',
    source: '源',

    // Pipeline
    stageFetch: '采集',
    stageFilter: '筛选 & 摘要',
    stageAnalyze: '分析',
    stageWrite: '撰写',

    // Live phase hints
    phaseIdle: '准备开始...',
    phaseFetched: '已采集到候选资讯，正在筛选 & 摘要...',
    phaseCurated: '已筛选有价值的内容，正在生成摘要...',
    phaseSummarized: '筛选 & 摘要完成，正在做趋势分析...',
    phaseAnalyzed: '分析完成，正在撰写最终报告...',
    phaseWriting: '正在撰写报告，即将完成...',
    phaseDone: '报告已就绪',

    // Feed
    feedLabel: 'News Feed',
    feedTitle: '资讯流',
    refresh: '刷新',
    newItems: '新增资讯',
    recurring: '持续关注',
    emptyFeed: '暂无资讯明细，点击"手动生成"后会在这里展示。',
    noNewBanner: '本次未发现新的 AI 动态，以下为最近仍值得关注的资讯。',
    sourceLabel: '源站',
    score: 'score',

    // Sidebar
    reportsLabel: 'Trend Reports',
    reportsTitle: '趋势报告',
    reportCount: '份',
    latest: '最新',
    viewReport: '查看完整报告',
    noSummary: '无摘要',
    noHistory: '暂无历史报告',
    noHistoryHint: '生成后会在这里保留',
    deleteReport: '删除报告',
    confirmDelete: '确定删除这份报告？',

    // Trigger badge
    triggerSchedule: '定时',
    triggerManual: '手动',

    // Status
    statusEmpty: '待生成',
    statusRunning: '生成中',
    statusSuccess: '已完成',
    statusFailed: '失败',

    // Time
    noTime: '尚未生成',
    unknownTime: '未知时间',

    // Mini typing card
    writingReport: '正在撰写报告',
    chars: '字',
    expandClick: '点击展开 →',

    // Drawer
    liveWriting: 'Live Writing',
    fullReport: 'Full Report',
    writingTitle: '正在撰写报告...',
    reportTitle: '趋势报告',

    // Onboarding
    onboardingTitle: '开始你的第一份 AI 趋势报告',
    onboardingDesc: '从 Hacker News、Dev.to、36kr 等公开技术资讯中聚合最新 AI 动态，通过 4 步 Agent 流水线（采集 → 策展 → 摘要 → 分析）输出可追溯的趋势报告。',
    onboardingFeature1: '多源采集',
    onboardingFeature2: '智能聚类',
    onboardingFeature3: '持续追踪',
    onboardingCta: '立即生成首份报告',
    onboardingGenerating: '正在生成...',

    // Drawer extras
    liveTag: '实时生成中',
    drawerLoading: '加载报告中...',
    reportItems: '条资讯',
    reportNew: '条新增',
    noMoreHistory: '暂无更多历史报告',
    close: '关闭',

    // Live phase tags
    phaseTagFetched: '采集',
    phaseTagCurated: '已筛选',
    phaseTagSummarized: '已摘要',
    otherCategory: '其他',
    unknownTimeLabel: '未知时间',
    fallbackSummary: '动态',

    // Deploy FAB
    deployButton: '一键部署',
    deployDesc: '使用 {link} 部署你自己的 AI 趋势监控站点，全球 CDN 加速，完全免费。',
    deployLink: 'EdgeOne Makers',
  },
  en: {
    // Header
    eyebrow: 'AI Trends Monitor',
    title: 'AI Trends Summary',
    subtitle: 'Automatically crawl, curate, and summarize AI industry news into traceable trend reports.',
    scheduleHint: 'Daily at 1:00 UTC',
    generate: 'Generate',
    generating: 'Generating...',
    stop: 'Stop',

    // Stats bar
    lastGenerated: 'Last generated',
    items: 'items',
    topics: 'topics',
    source: 'Sources',

    // Pipeline
    stageFetch: 'Fetch',
    stageFilter: 'Filter & Summarize',
    stageAnalyze: 'Analyze',
    stageWrite: 'Write',

    // Live phase hints
    phaseIdle: 'Preparing...',
    phaseFetched: 'Collected candidates, filtering & summarizing...',
    phaseCurated: 'Filtered valuable content, generating summaries...',
    phaseSummarized: 'Summaries done, analyzing trends...',
    phaseAnalyzed: 'Analysis complete, writing final report...',
    phaseWriting: 'Writing report, almost done...',
    phaseDone: 'Report ready',

    // Feed
    feedLabel: 'News Feed',
    feedTitle: 'News Feed',
    refresh: 'Refresh',
    newItems: 'New Items',
    recurring: 'Ongoing',
    emptyFeed: 'No items yet. Click "Generate" to start.',
    noNewBanner: 'No new AI trends found this time. Here are recent items still worth noting.',
    sourceLabel: 'Source',
    score: 'score',

    // Sidebar
    reportsLabel: 'Trend Reports',
    reportsTitle: 'Reports',
    reportCount: '',
    latest: 'Latest',
    viewReport: 'View full report',
    noSummary: 'No summary',
    noHistory: 'No report history',
    noHistoryHint: 'Reports will appear here after generation',
    deleteReport: 'Delete report',
    confirmDelete: 'Delete this report?',

    // Trigger badge
    triggerSchedule: 'Scheduled',
    triggerManual: 'Manual',

    // Status
    statusEmpty: 'Pending',
    statusRunning: 'Running',
    statusSuccess: 'Done',
    statusFailed: 'Failed',

    // Time
    noTime: 'Not generated',
    unknownTime: 'Unknown',

    // Mini typing card
    writingReport: 'Writing report',
    chars: 'chars',
    expandClick: 'Click to expand →',

    // Drawer
    liveWriting: 'Live Writing',
    fullReport: 'Full Report',
    writingTitle: 'Writing report...',
    reportTitle: 'Trend Report',

    // Onboarding
    onboardingTitle: 'Generate Your First AI Trend Report',
    onboardingDesc: 'Aggregate the latest AI news from Hacker News, Dev.to, 36kr and more through a 4-step Agent pipeline (Collect → Curate → Summarize → Analyze) into a traceable trend report.',
    onboardingFeature1: 'Multi-source',
    onboardingFeature2: 'Smart Clustering',
    onboardingFeature3: 'Continuous Tracking',
    onboardingCta: 'Generate first report',
    onboardingGenerating: 'Generating...',

    // Drawer extras
    liveTag: 'Live generating',
    drawerLoading: 'Loading report...',
    reportItems: 'items',
    reportNew: 'new',
    noMoreHistory: 'No more history',
    close: 'Close',

    // Live phase tags
    phaseTagFetched: 'Fetched',
    phaseTagCurated: 'Curated',
    phaseTagSummarized: 'Summarized',
    otherCategory: 'Other',
    unknownTimeLabel: 'Unknown',
    fallbackSummary: 'update',

    // Deploy FAB
    deployButton: 'Deploy',
    deployDesc: 'Deploy your own AI trend monitor with {link} — lightning-fast global CDN, completely free.',
    deployLink: 'EdgeOne Makers',
  },
} as const;

export type TranslationKey = keyof typeof translations['zh'];

const I18nContext = createContext<{
  locale: Locale;
  t: (key: TranslationKey) => string;
  toggleLocale: () => void;
}>({
  locale: 'zh',
  t: (key) => translations.zh[key],
  toggleLocale: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai-trends-locale');
      if (saved === 'en' || saved === 'zh') return saved;
    }
    return 'zh';
  });

  const toggleLocale = useCallback(() => {
    setLocale(prev => {
      const next = prev === 'zh' ? 'en' : 'zh';
      localStorage.setItem('ai-trends-locale', next);
      return next;
    });
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale][key] ?? key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, t, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
