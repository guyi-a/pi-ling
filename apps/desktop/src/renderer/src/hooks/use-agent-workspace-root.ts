import { useEffect, useState } from "react";

export function useAgentWorkspaceRoot(): string | undefined {
  const [root, setRoot] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    void window.piLing.getAgentStatus().then((status) => {
      if (!cancelled) {
        setRoot(status.workspace?.root);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return root;
}
