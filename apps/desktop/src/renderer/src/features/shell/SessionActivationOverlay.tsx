import { LoaderCircle } from "lucide-react";

export function SessionActivationOverlay(props: { message: string }) {
  return (
    <div
      className="session-activation-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="session-activation-card">
        <LoaderCircle
          className="session-activation-spinner"
          size={28}
          aria-hidden
        />
        <strong className="session-activation-title">{props.message}</strong>
        <p className="session-activation-subtitle">
          请稍候，正在准备 Agent 会话
        </p>
      </div>
    </div>
  );
}
