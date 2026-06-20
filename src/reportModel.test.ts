import { normalizeReport } from './reportModel';

const normalized = normalizeReport({ status: 'empty', reportMarkdown: '# Empty' });

if (!Array.isArray(normalized.items)) {
  throw new Error('normalizeReport should default missing items to []');
}

if (!Array.isArray(normalized.trends)) {
  throw new Error('normalizeReport should default missing trends to []');
}

if (normalized.reportMarkdown !== '# Empty') {
  throw new Error('normalizeReport should preserve reportMarkdown');
}
