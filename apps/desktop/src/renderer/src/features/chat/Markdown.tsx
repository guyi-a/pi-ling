import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import { Streamdown } from "streamdown";

import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { externalHrefFromClickTarget } from "./external-link";
import { tagPlainCodeFenceOpenings } from "./normalize-plain-code-fences";

const PLAIN_CODE_LANGUAGES = [
  "",
  "text",
  "plaintext",
  "txt",
  "console",
  "terminal",
  "shell",
  "sh",
  "bash",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "bat",
  "ps1",
  "ascii",
  "diagram",
  "tree",
  "flow",
] as const;

export const Markdown = memo(function Markdown(props: {
  children: string;
  streaming?: boolean;
}) {
  const plugins = useMemo(
    () => ({
      renderers: [
        {
          language: [...PLAIN_CODE_LANGUAGES],
          component: MarkdownCodeBlock,
        },
      ],
    }),
    [],
  );

  function openLink(event: MouseEvent<HTMLDivElement>) {
    const href = externalHrefFromClickTarget(event.target);
    // 应用内不做页面跳转；可打开的链接交给系统浏览器
    event.preventDefault();
    if (href) void window.piLing.openExternal(href);
  }

  return (
    <div
      className={`markdown ${props.streaming ? "is-streaming" : ""}`}
      onClickCapture={openLink}
    >
      <Streamdown
        lineNumbers={false}
        controls={{ table: false, code: { copy: true, download: false } }}
        translations={{ copyCode: "复制", copied: "已复制" }}
        isAnimating={props.streaming}
        plugins={plugins}
        /* 关掉内置的「Open external link?」确认弹窗：点击直接交给系统浏览器 */
        linkSafety={{ enabled: false }}
      >
        {tagPlainCodeFenceOpenings(props.children)}
      </Streamdown>
    </div>
  );
});
