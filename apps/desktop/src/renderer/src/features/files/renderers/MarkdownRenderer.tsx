import { Markdown } from "../../chat/Markdown";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="files-markdown">
      <Markdown>{content}</Markdown>
    </div>
  );
}
