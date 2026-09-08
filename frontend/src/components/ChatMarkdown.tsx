import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Model output is untrusted text: no raw HTML, embedded media, or executable links. */
export default function ChatMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    components={{
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt ? `画像: ${alt}` : "画像"}</span>,
      table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
    }}>{content}</Markdown></div>;
}
