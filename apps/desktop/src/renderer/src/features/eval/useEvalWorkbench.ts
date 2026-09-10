import type {
  EvalCompareRequest,
  EvalCompareView,
  EvalRunResultView,
  EvalRunSuiteRequest,
  EvalRunTaskRequest,
  EvalSuiteProgressEvent,
  EvalTaskDetail,
  EvalTaskOverrideRequest,
  EvalWorkbenchState,
} from "@pi-ling/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export type EvalTab = "catalog" | "results" | "compare";

export function useEvalWorkbench() {
  const [state, setState] = useState<EvalWorkbenchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<EvalTab>("catalog");
  const [liveResults, setLiveResults] = useState<EvalRunResultView[]>([]);
  const [selectedRunResults, setSelectedRunResults] = useState<
    EvalRunResultView[]
  >([]);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
  const [compareView, setCompareView] = useState<EvalCompareView | null>(null);
  const [compareRequest, setCompareRequest] = useState<EvalCompareRequest | null>(
    null,
  );
  const [taskDetail, setTaskDetail] = useState<EvalTaskDetail | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const loadRunResults = useCallback(async (experiment: string, variant: string) => {
    const results = await window.piLing.getEvalRunResults(experiment, variant);
    setSelectedRunResults(results);
    return results;
  }, []);

  const refresh = useCallback(async () => {
    const next = await window.piLing.getEvalState();
    setState(next);
    if (!initializedRef.current) {
      initializedRef.current = true;
      if (next.latestRun) {
        const key = `${next.latestRun.experiment}\0${next.latestRun.variant}`;
        setSelectedRunKey(key);
        setSelectedRunResults(next.latestRun.results);
      }
      if (next.suggestedCompare) {
        setCompareRequest(next.suggestedCompare);
      }
    }
    setRunning(Boolean(next.activeRun));
    if (next.activeRun) {
      setProgressText(
        next.activeRun.total > 0
          ? `${next.activeRun.index}/${next.activeRun.total} ${next.activeRun.taskId}`
          : "Starting…",
      );
    } else if (!running) {
      setProgressText(null);
    }
    return next;
  }, [running]);

  useEffect(() => {
    let cancelled = false;
    void refresh().catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleProgress = useCallback(
    async (event: EvalSuiteProgressEvent) => {
      if (event.phase === "task-start") {
        setRunning(true);
        setProgressText(`${event.index}/${event.total} ${event.taskId}`);
        setTab("results");
      }
      if (event.phase === "task-done" && event.result) {
        setLiveResults((current) => {
          const next = [...current];
          const index = next.findIndex(
            (row) => row.taskId === event.result!.taskId,
          );
          if (index >= 0) next[index] = event.result!;
          else next.push(event.result!);
          return next;
        });
        setProgressText(`${event.index}/${event.total} ${event.taskId}`);
      }
      if (event.phase === "suite-done" || event.phase === "suite-error") {
        setRunning(false);
        setProgressText(
          event.phase === "suite-error" ? event.error ?? "Run failed" : null,
        );
        const next = await refresh();
        if (next.latestRun) {
          const key = `${next.latestRun.experiment}\0${next.latestRun.variant}`;
          setSelectedRunKey(key);
          setSelectedRunResults(next.latestRun.results);
          setLiveResults([]);
        }
      }
    },
    [refresh],
  );

  useEffect(() => {
    const unsubscribe = window.piLing.onEvalProgress((event) => {
      void handleProgress(event);
    });
    return unsubscribe;
  }, [handleProgress]);

  const runSuite = async (request: EvalRunSuiteRequest) => {
    setError(null);
    setLiveResults([]);
    setRunning(true);
    try {
      await window.piLing.runEvalSuite(request);
      setTab("results");
    } catch (reason) {
      setRunning(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const runTask = async (request: EvalRunTaskRequest) => {
    setError(null);
    setLiveResults([]);
    setRunning(true);
    try {
      await window.piLing.runEvalTask(request);
      setTab("results");
    } catch (reason) {
      setRunning(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const cancelRun = async () => {
    await window.piLing.cancelEvalRun();
    setProgressText("Cancelling…");
  };

  const loadCompare = async (request: EvalCompareRequest) => {
    setCompareRequest(request);
    const view = await window.piLing.compareEvalRuns(request);
    setCompareView(view);
    setTab("compare");
  };

  const loadTaskDetail = async (taskId: string) => {
    setSelectedTaskId(taskId);
    const detail = await window.piLing.getEvalTaskDetail(taskId);
    setTaskDetail(detail);
  };

  const saveOverride = async (request: EvalTaskOverrideRequest) => {
    if (request.enabled !== undefined) {
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((task) =>
            task.id === request.taskId
              ? {
                  ...task,
                  enabled: request.enabled!,
                  ...(request.enabled === false
                    ? { baselineIncluded: false }
                    : {}),
                }
              : task,
          ),
        };
      });
    }
    try {
      const next = await window.piLing.saveEvalTaskOverride(request);
      setState(next);
      await loadTaskDetail(request.taskId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refresh();
      await loadTaskDetail(request.taskId);
    }
  };

  const clearOverride = async (taskId: string) => {
    const next = await window.piLing.clearEvalTaskOverride(taskId);
    setState(next);
    await loadTaskDetail(taskId);
  };

  const selectRun = async (key: string) => {
    setSelectedRunKey(key);
    const [experiment, variant] = key.split("\0");
    if (!experiment || !variant) return;
    await loadRunResults(experiment, variant);
    setTab("results");
  };

  const selectedRun = state?.runs.find(
    (run) => `${run.experiment}\0${run.variant}` === selectedRunKey,
  );

  const displayedResults = running ? liveResults : selectedRunResults;

  return {
    state,
    error,
    tab,
    setTab,
    refresh,
    runSuite,
    runTask,
    cancelRun,
    loadCompare,
    compareView,
    compareRequest,
    setCompareRequest,
    taskDetail,
    selectedTaskId,
    loadTaskDetail,
    saveOverride,
    clearOverride,
    running,
    progressText,
    selectedRunKey,
    setSelectedRunKey,
    selectRun,
    selectedRun,
    displayedResults,
  };
}
