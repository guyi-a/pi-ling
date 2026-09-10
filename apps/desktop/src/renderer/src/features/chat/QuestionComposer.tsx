import { useId, useState } from "react";

import type { AskUserQuestion } from "@pi-ling/contracts";

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Selection =
  | { kind: "option"; label: string }
  | { kind: "other"; text: string }
  | { kind: "empty" };

function hasAnswer(selection: Selection): boolean {
  if (selection.kind === "option") return true;
  if (selection.kind === "other") return selection.text.trim().length > 0;
  return false;
}

export function QuestionComposer(props: {
  question: AskUserQuestion;
  onContinue: (selection: Selection) => void;
  onSkip: () => void;
  continueLabel: string;
}) {
  const { question, onContinue, onSkip, continueLabel } = props;
  const groupId = useId();
  const [selection, setSelection] = useState<Selection>({ kind: "empty" });
  const options = question.options ?? [];

  return (
    <div className="question-composer">
      {question.header ? (
        <div className="question-header">{question.header}</div>
      ) : null}
      <div className="question-prompt">{question.question}</div>
      <div className="question-options" role="radiogroup" aria-label={question.question}>
        {options.map((option, index) => {
          const letter = OPTION_LETTERS[index] ?? String(index + 1);
          const selected =
            selection.kind === "option" && selection.label === option.label;
          return (
            <button
              key={`${option.label}:${index}`}
              type="button"
              className={`question-option${selected ? " selected" : ""}`}
              role="radio"
              aria-checked={selected}
              onClick={() => setSelection({ kind: "option", label: option.label })}
            >
              <span className="question-option-letter">{letter}</span>
              <span className="question-option-body">
                <span className="question-option-label">{option.label}</span>
                {option.description ? (
                  <span className="question-option-description">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        <label
          className={`question-option question-option-other${
            selection.kind === "other" ? " selected" : ""
          }`}
        >
          <span className="question-option-letter">
            {OPTION_LETTERS[options.length] ?? "…"}
          </span>
          <span className="question-option-body question-option-body-other">
            <input
              type="text"
              className="question-other-input"
              placeholder="Other..."
              value={selection.kind === "other" ? selection.text : ""}
              onFocus={() =>
                setSelection((current) =>
                  current.kind === "other"
                    ? current
                    : { kind: "other", text: "" },
                )
              }
              onChange={(event) =>
                setSelection({ kind: "other", text: event.target.value })
              }
            />
          </span>
        </label>
      </div>
      <div className="question-actions">
        <button type="button" className="question-skip" onClick={onSkip}>
          Skip
        </button>
        <button
          type="button"
          className="question-continue"
          disabled={!hasAnswer(selection)}
          onClick={() => onContinue(selection)}
        >
          {continueLabel}
        </button>
      </div>
      <span id={groupId} hidden>
        {question.id}
      </span>
    </div>
  );
}

export function selectionToAnswer(
  questionId: string,
  selection: Selection,
): { id: string; selected: string[]; custom?: string } {
  if (selection.kind === "option") {
    return { id: questionId, selected: [selection.label] };
  }
  if (selection.kind === "other" && selection.text.trim()) {
    return { id: questionId, selected: [], custom: selection.text.trim() };
  }
  return { id: questionId, selected: [] };
}
