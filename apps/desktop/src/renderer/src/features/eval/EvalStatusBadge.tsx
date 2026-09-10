import type { EvalRunResultView } from "@pi-ling/contracts";

import { statusClass, statusLabel } from "./eval-format";

export function EvalStatusBadge(props: {
  status: EvalRunResultView["status"] | "missing";
}) {
  return (
    <span className={`eval-badge eval-badge-${statusClass(props.status).replace("is-", "")}`}>
      {statusLabel(props.status)}
    </span>
  );
}
