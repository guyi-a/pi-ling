import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FilesState {
  previewPath: string | null;
  previewLine: number | null;
  switcherOpen: boolean;
  filesVersion: number;
  expandedDirectories: Record<string, true>;
  openFile: (path: string, line?: number) => void;
  closePreview: () => void;
  resetForRoot: () => void;
  toggleDirectory: (key: string) => void;
  toggleSwitcher: () => void;
  closeSwitcher: () => void;
  refreshFiles: () => void;
}

const REFRESH_THROTTLE_MS = 600;
let lastRefreshAt = 0;
let activateFilesTab: (() => void) | null = null;

export function bindFilesTabActivator(fn: () => void): void {
  activateFilesTab = fn;
}

export const useFilesStore = create<FilesState>()(
  persist(
    (set) => ({
      previewPath: null,
      previewLine: null,
      switcherOpen: false,
      filesVersion: 0,
      expandedDirectories: {},
      openFile: (path, line) => {
        activateFilesTab?.();
        set({
          previewPath: path,
          previewLine: line && line > 0 ? line : null,
          switcherOpen: false,
        });
      },
      closePreview: () =>
        set({ previewPath: null, previewLine: null, switcherOpen: false }),
      resetForRoot: () =>
        set((state) => ({
          previewPath: null,
          previewLine: null,
          switcherOpen: false,
          filesVersion: state.filesVersion + 1,
        })),
      toggleDirectory: (key) =>
        set((state) => {
          const expandedDirectories = { ...state.expandedDirectories };
          if (expandedDirectories[key]) {
            delete expandedDirectories[key];
          } else {
            expandedDirectories[key] = true;
          }
          return { expandedDirectories };
        }),
      toggleSwitcher: () =>
        set((state) => ({ switcherOpen: !state.switcherOpen })),
      closeSwitcher: () => set({ switcherOpen: false }),
      refreshFiles: () => {
        const now = Date.now();
        if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
        lastRefreshAt = now;
        set((state) => ({ filesVersion: state.filesVersion + 1 }));
      },
    }),
    {
      name: "pi-ling.files",
      partialize: (state) => ({
        expandedDirectories: state.expandedDirectories,
      }),
    },
  ),
);

export function refreshFilesFromOutside(): void {
  useFilesStore.getState().refreshFiles();
}
