import type { ReactNode } from "react";

import type { UserTimelineItem } from "../../timeline/reducer";
import { UserTurnPrompt } from "./UserTurnPrompt";

export function TurnBlock(props: {
  user?: UserTimelineItem;
  workspaceRoot?: string;
  children: ReactNode;
}) {
  return (
    <section className="turn-block" aria-label="对话轮次">
      {props.user ? (
        <UserTurnPrompt item={props.user} workspaceRoot={props.workspaceRoot} />
      ) : null}
      <div className="turn-block-body">{props.children}</div>
    </section>
  );
}
