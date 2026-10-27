import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}
    components={{
      a: ({ children: label, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>,
      h1: ({ children: heading }) => <h4>{heading}</h4>,
      h2: ({ children: heading }) => <h4>{heading}</h4>,
      h3: ({ children: heading }) => <h4>{heading}</h4>,
    }}>
    {children}
  </ReactMarkdown></div>;
}
