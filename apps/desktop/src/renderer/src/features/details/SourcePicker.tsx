import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ChangedFile } from "@pi-ling/contracts";

import type { ChangesSourceId } from "./changes-source";
import {
  CHANGES_SOURCES,
  sourceDef,
  sumChanges,
} from "./changes-source";

export function SourcePicker(props: {
  value: ChangesSourceId;
  files: readonly ChangedFile[];
  onChange: (source: ChangesSourceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = sourceDef(props.value);
  const total = sumChanges(props.files);
  const CurrentIcon = current.icon;

  return (
    <details
      className="source-picker"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label="Changes source">
        <CurrentIcon className="source-picker-icon" />
        <span className="source-picker-label">{current.label}</span>
        {total.additions > 0 || total.deletions > 0 ? (
          <span className="source-picker-total">
            <span className="diff-add">+{total.additions}</span>
            <span className="diff-delete">-{total.deletions}</span>
          </span>
        ) : null}
        <ChevronDown className="source-picker-chevron" />
      </summary>
      <div className="source-menu">
        {CHANGES_SOURCES.map((source) => {
          const SourceIcon = source.icon;
          const selected = source.id === props.value;
          return (
            <button
              type="button"
              className={selected ? "selected" : ""}
              disabled={!source.enabled}
              key={source.id}
              onClick={() => {
                setOpen(false);
                props.onChange(source.id);
              }}
            >
              <SourceIcon />
              <span>
                <strong>{source.label}</strong>
                <small>
                  {source.enabled
                    ? source.description
                    : `${source.description} · 即将上线`}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

export type { ChangesSourceId };
