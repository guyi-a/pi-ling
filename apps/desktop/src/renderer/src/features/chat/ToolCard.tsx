import {
  Check,
  FileCode,
  FilePen,
  FileText,
  FolderTree,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import type {
  ApprovalTimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ApprovalCard } from "./ApprovalCard";

const metadata: Record<
  string,
  {
    label: string;
    icon: LucideIcon;
    summary: (input: Record<string, unknown>) => string;
  }
> = {
  read_file: {
    label: "读取文件",
    icon: FileText,
    summary: (input) => String(input["path"] ?? ""),
  },
  list_files: {
    label: "浏览目录",
    icon: FolderTree,
    summary: (input) => String(input["path"] ?? "工作区根目录"),
  },
  grep: {
    label: "搜索内容",
    icon: Search,
    summary: (input) => String(input["pattern"] ?? ""),
  },
  write_file: {
    label: "写入文件",
    icon: FilePen,
    summary: (input) => String(input["path"] ?? ""),
  },
  edit_file: {
    label: "编辑文件",
    icon: FileCode,
    summary: (input) => String(input["path"] ?? ""),
  },
  run_command: {
    label: "执行命令",
    icon: SquareTerminal,
    summary: (input) => String(input["command"] ?? ""),
  },
};

const statusLabel: Record<ToolTimelineItem["status"], string> = {
  requested: "等待",
  "awaiting-approval": "待确认",
  running: "运行中",
  completed: "完成",
  failed: "失败",
  denied: "已拒绝",
};

export function ToolCard(props: {
  item: ToolTimelineItem;
  approval?: ApprovalTimelineItem;
  onApproval?: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => void;
}) {
  const { item, approval, onApproval } = props;
  const meta = metadata[item.tool] ?? {
    label: item.tool,
    icon: Wrench,
    summary: () => "",
  };
  const StateIcon =
    item.status === "running"
      ? LoaderCircle
      : item.status === "completed"
        ? Check
        : item.status === "failed" || item.status === "denied"
          ? X
          : meta.icon;
  const summary = meta.summary(item.arguments);

  return (
    <div className={`tool-card ${item.status}`}>
      <div className="tool-card-header">
        <StateIcon className={`tool-icon ${item.status}`} />
        <span className="tool-label">{meta.label}</span>
        <span className="tool-summary" title={summary}>
          {summary}
        </span>
        <span className="tool-state">{statusLabel[item.status]}</span>
      </div>
      <details className="tool-arguments">
        <summary>参数</summary>
        <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
      </details>
      {item.output ? (
        <details className="tool-output">
          <summary>输出</summary>
          <pre>{item.output}</pre>
        </details>
      ) : null}
      {approval && onApproval ? (
        <ApprovalCard item={approval} onDecision={onApproval} />
      ) : null}
    </div>
  );
}
