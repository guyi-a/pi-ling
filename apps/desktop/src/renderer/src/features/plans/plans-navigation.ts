let activatePlansTab: ((runId?: string) => void) | null = null;

export function bindPlansNavigation(handlers: {
  activatePlansTab: (runId?: string) => void;
}): void {
  activatePlansTab = handlers.activatePlansTab;
}

export function openPlansPanel(runId?: string): void {
  activatePlansTab?.(runId);
}
