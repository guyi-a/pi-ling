let activateChangesTab: (() => void) | null = null;
let reviewRunHandler: ((runId: string) => void) | null = null;

export function bindChangesNavigation(handlers: {
  activateChangesTab: () => void;
  onReviewRun: (runId: string) => void;
}): void {
  activateChangesTab = handlers.activateChangesTab;
  reviewRunHandler = handlers.onReviewRun;
}

export function openAgentTurnReview(runId: string): void {
  reviewRunHandler?.(runId);
  activateChangesTab?.();
}
