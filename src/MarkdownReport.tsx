import type { ReactNode } from 'react';
import styles from './App.module.css';

interface MarkdownReportProps {
  markdown: string;
}

/**
 * Parse inline markdown: **bold**, [link](url), and plain text.
 * Handles multiple links and bold segments within a single line.
 */
function renderInline(text: string): ReactNode {
  // Split by bold and link patterns, keeping delimiters
  const tokens = text.split(/(\*\*.+?\*\*|\[.+?\]\(.+?\))/g).filter(Boolean);
  return tokens.map((token, i) => {
    // Bold
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={i}>{token.slice(2, -2)}</strong>;
    }
    // Link
    const linkMatch = token.match(/^\[(.+?)\]\((.+?)\)$/);
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noreferrer">{linkMatch[1]}</a>;
    }
    // Plain text
    return <span key={i}>{token}</span>;
  });
}

export default function MarkdownReport({ markdown }: MarkdownReportProps) {
  const lines = markdown.split('\n');

  return (
    <article className={styles.markdown}>
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={index} className={styles.reportSpacer} />;

        // Headings
        if (line.startsWith('# ')) {
          return <h1 key={index}>{line.slice(2)}</h1>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={index}>{line.slice(3)}</h2>;
        }
        if (line.startsWith('### ')) {
          return <h3 key={index}>{line.slice(4)}</h3>;
        }

        // Meta rows (生成时间：... / 分析内容：...)
        if (line.startsWith('生成时间：') || line.startsWith('分析内容：')) {
          const [label, ...rest] = line.split('：');
          return (
            <div key={index} className={styles.reportMetaRow}>
              <span>{label}</span>
              <strong>{rest.join('：')}</strong>
            </div>
          );
        }

        // Numbered items: "1. **Title**：description" or "1. **Title** description"
        // Also handles: "1. **Title？** description" and variations with Chinese/English punctuation
        const overviewMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*[：:.]?\s*(.*)$/);
        if (overviewMatch) {
          return (
            <div key={index} className={styles.overviewItem}>
              <span className={styles.overviewIndex}>{overviewMatch[1]}</span>
              <div>
                <strong>{overviewMatch[2]}</strong>
                {overviewMatch[3] && <p>{renderInline(overviewMatch[3])}</p>}
              </div>
            </div>
          );
        }

        // Numbered items with links: "1. [Title](url) —— description" or "1. [Title](url) — description"
        const numberedLinkMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (numberedLinkMatch) {
          const content = numberedLinkMatch[2];
          // Check if it contains a link
          if (content.includes('[') && content.includes('](')) {
            return (
              <div key={index} className={styles.overviewItem}>
                <span className={styles.overviewIndex}>{numberedLinkMatch[1]}</span>
                <div><p>{renderInline(content)}</p></div>
              </div>
            );
          }
          // Plain numbered item without bold
          return (
            <div key={index} className={styles.overviewItem}>
              <span className={styles.overviewIndex}>{numberedLinkMatch[1]}</span>
              <div><p>{renderInline(content)}</p></div>
            </div>
          );
        }

        // Unordered list
        if (line.startsWith('- ')) {
          return <li key={index} className={styles.reportListItem}>{renderInline(line.slice(2))}</li>;
        }

        // Horizontal rule
        if (/^[-*_]{3,}$/.test(line)) {
          return <hr key={index} className={styles.reportDivider} />;
        }

        // Default paragraph
        return <p key={index}>{renderInline(line)}</p>;
      })}
    </article>
  );
}
