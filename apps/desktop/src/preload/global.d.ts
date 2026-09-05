import type { DesktopApi } from "@pi-ling/contracts";

declare global {
  interface Window {
    piLing: DesktopApi;
  }
}

export {};
