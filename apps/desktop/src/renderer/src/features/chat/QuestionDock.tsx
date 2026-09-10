import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { AskUserAnswer } from "@pi-ling/contracts";

import type { QuestionTimelineItem } from "../../timeline/reducer";
import {
  QuestionComposer,
  selectionToAnswer,
} from "./QuestionComposer";

export function QuestionDock(props: {
  question: QuestionTimelineItem;
  onSubmit: (answers: AskUserAnswer[]) => void;
}) {
  const questions = props.question.question.questions;
  const [page, setPage] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<AskUserAnswer[]>([]);
  const current = questions[page];
  const total = questions.length;
  const isLast = page >= total - 1;

  const continueLabel = useMemo(
    () => (isLast ? "Continue" : "Next"),
    [isLast],
  );

  if (!current) {
    return null;
  }

  return (
    <section
      className="question-dock"
      aria-label="Questions"
      role="dialog"
      aria-modal="true"
    >
      <div className="question-dock-title">Questions</div>
      <QuestionComposer
        key={current.id}
        question={current}
        continueLabel={continueLabel}
        onSkip={() => {
          const answer = selectionToAnswer(current.id, { kind: "empty" });
          const nextAnswers = [...draftAnswers, answer];
          if (isLast) {
            props.onSubmit(nextAnswers);
            return;
          }
          setDraftAnswers(nextAnswers);
          setPage((value) => value + 1);
        }}
        onContinue={(selection) => {
          const answer = selectionToAnswer(current.id, selection);
          const nextAnswers = [...draftAnswers, answer];
          if (isLast) {
            props.onSubmit(nextAnswers);
            return;
          }
          setDraftAnswers(nextAnswers);
          setPage((value) => value + 1);
        }}
      />
      {total > 1 ? (
        <div className="question-pagination">
          <button
            type="button"
            className="question-page-button"
            aria-label="Previous question"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="question-page-indicator">
            {page + 1} of {total}
          </span>
          <button
            type="button"
            className="question-page-button"
            aria-label="Next question"
            disabled={page >= total - 1}
            onClick={() => setPage((value) => Math.min(total - 1, value + 1))}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
