import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { FileViewMode } from "./file-views";

interface FilesState {
  previewPath: string | null;
  previewLine: number | null;
  switcherOpen: boolean;
  /** Bumps only when the workspace root changes (hard reset). */
  filesVersion: number;
  /** Bumps when the tree should refresh in the background. */
  treeEpoch: number;
  expandedDirectories: Record<string, true>;
  /**
   * 上次选择的视图（Preview / Source）。全局记住，切换一次后对同类文件生效。
   */
  viewMode: FileViewMode | null;
  /** 当前打开的文件是否有未保存改动 —— 决定树点击是否需要拦截。 */
  dirty: boolean;
  /**
   * 因未保存改动而被拦下的导航目标。
   * 非空时面板顶部显示「保存并打开 / 放弃更改 / 取消」提示条。
   */
  pendingPath: string | null;
  /** 被拦下的「关闭预览」请求。 */
  pendingClose: boolean;

  openFile: (path: string, line?: number) => void;
  /**
   * 树点击入口：当前文件有未保存改动时不直接切换，改为挂起并提示。
   */
  requestOpenFile: (path: string, line?: number) => void;
  closePreview: () => void;
  requestClosePreview: () => void;
  setViewMode: (mode: FileViewMode) => void;
  setDirty: (dirty: boolean) => void;
  /** 放弃改动并前往挂起的目标（若有）。 */
  discardPending: () => void;
  /** 打消挂起的导航，留在当前文件。 */
  cancelPending: () => void;
  resetForRoot: () => void;
  toggleDirectory: (key: string) => void;
  toggleSwitcher: () => void;
  closeSwitcher: () => void;
  refreshTree: () => void;
}

const REFRESH_THROTTLE_MS = 600;
let lastRefreshAt = 0;
let activateFilesTab: (() => void) | null = null;

export function bindFilesTabActivator(fn: () => void): void {
  activateFilesTab = fn;
}

export const useFilesStore = create<FilesState>()(
  persist(
    (set, get) => ({
      previewPath: null,
      previewLine: null,
      switcherOpen: false,
      filesVersion: 0,
      treeEpoch: 0,
      expandedDirectories: {},
      viewMode: null,
      dirty: false,
      pendingPath: null,
      pendingClose: false,

      openFile: (path, line) => {
        activateFilesTab?.();
        set({
          previewPath: path,
          previewLine: line && line > 0 ? line : null,
          switcherOpen: false,
          dirty: false,
          pendingPath: null,
          pendingClose: false,
        });
      },

      requestOpenFile: (path, line) => {
        const state = get();
        // 打开同一个文件不拦截，否则点一下自己就弹提示
        if (state.dirty && path !== state.previewPath) {
          activateFilesTab?.();
          set({ pendingPath: path, pendingClose: false });
          return;
        }
        get().openFile(path, line);
      },

      closePreview: () =>
        set({
          previewPath: null,
          previewLine: null,
          switcherOpen: false,
          dirty: false,
          pendingPath: null,
          pendingClose: false,
        }),

      requestClosePreview: () => {
        if (get().dirty) {
          set({ pendingClose: true, pendingPath: null });
          return;
        }
        get().closePreview();
      },

      setViewMode: (mode) => set({ viewMode: mode }),

      setDirty: (dirty) => set({ dirty }),

      discardPending: () => {
        const { pendingPath, pendingClose, previewPath } = get();
        set({ dirty: false, pendingPath: null, pendingClose: false });
        if (pendingClose) {
          get().closePreview();
          return;
        }
        if (pendingPath && pendingPath !== previewPath) {
          get().openFile(pendingPath);
        }
      },

      cancelPending: () => set({ pendingPath: null, pendingClose: false }),

      resetForRoot: () =>
        set((state) => ({
          previewPath: null,
          previewLine: null,
          switcherOpen: false,
          dirty: false,
          pendingPath: null,
          pendingClose: false,
          filesVersion: state.filesVersion + 1,
          treeEpoch: state.treeEpoch + 1,
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

      refreshTree: () => {
        const now = Date.now();
        if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
        lastRefreshAt = now;
        set((state) => ({ treeEpoch: state.treeEpoch + 1 }));
      },
    }),
    {
      name: "pi-ling.files",
      partialize: (state) => ({
        expandedDirectories: state.expandedDirectories,
        viewMode: state.viewMode,
      }),
    },
  ),
);

export function refreshFilesFromOutside(): void {
  useFilesStore.getState().refreshTree();
}
