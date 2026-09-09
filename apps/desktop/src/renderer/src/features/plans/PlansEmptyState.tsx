export function PlansEmptyState(props: { hasSession: boolean }) {
  return (
    <div className="plans-empty">
      <strong>Plans</strong>
      <p>
        {props.hasSession
          ? "当前 run 暂无 plan。"
          : "选择一个 session 后查看 agent 方案。"}
      </p>
    </div>
  );
}
