'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import CodeBlock from './CodeBlock';

export const MessageContent = ({ content }: { content: string }) => (
  <div className="markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Wide tables scroll sideways on a phone instead of wrapping letter-by-letter.
        table: ({ children }: { children?: ReactNode }) => (
          <div className="markdown-table-scroll">
            <table>{children}</table>
          </div>
        ),
        // Fenced code arrives as <pre><code class="language-x">. Inline `code` is left alone.
        pre: ({ children }: { children?: ReactNode }) => {
          const child = Children.toArray(children)[0];
          const className = isValidElement(child)
            ? ((child.props as { className?: string }).className ?? '')
            : '';
          const language = /language-([\w-]+)/.exec(className)?.[1];
          return <CodeBlock language={language}>{children}</CodeBlock>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
