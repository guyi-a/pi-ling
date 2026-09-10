import { createContext, useContext } from "react";

import type { BackgroundTask } from "@pi-ling/contracts";

export const BackgroundTasksContext = createContext<
  ReadonlyMap<string, BackgroundTask>
>(new Map());

export function useBackgroundTask(
  callId: string,
): BackgroundTask | undefined {
  return useContext(BackgroundTasksContext).get(callId);
}
