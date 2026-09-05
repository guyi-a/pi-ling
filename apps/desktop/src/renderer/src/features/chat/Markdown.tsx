import { memo } from "react";
import type { MouseEvent } from "react";
import { Streamdown } from "streamdown";

export const Markdown = memo(function Markdown(props: {
  children: string;
  streaming?: boolean;
}) {
  function blockNavigation(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("a")) {
      event.preventDefault();
    }
  }

  return (
    <div
      className={`markdown ${props.streaming ? "is-streaming" : ""}`}
      onClickCapture={blockNavigation}
    >
      <Streamdown controls={{ table: false }}>{props.children}</Streamdown>
    </div>
  );
});
