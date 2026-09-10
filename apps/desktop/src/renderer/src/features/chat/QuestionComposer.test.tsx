import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QuestionComposer, selectionToAnswer } from "./QuestionComposer";

describe("QuestionComposer", () => {
  it("renders options and other input", () => {
    const html = renderToStaticMarkup(
      <QuestionComposer
        question={{
          id: "mode",
          question: "Which mode?",
          options: [
            { label: "Agent", description: "Full access" },
            { label: "Plan" },
          ],
        }}
        continueLabel="Continue"
        onContinue={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(html).toContain("Which mode?");
    expect(html).toContain("Agent");
    expect(html).toContain('placeholder="Other..."');
  });

  it("maps selections to answer payloads", () => {
    expect(selectionToAnswer("mode", { kind: "option", label: "Agent" })).toEqual({
      id: "mode",
      selected: ["Agent"],
    });
    expect(
      selectionToAnswer("mode", { kind: "other", text: "Hybrid" }),
    ).toEqual({
      id: "mode",
      selected: [],
      custom: "Hybrid",
    });
  });
});
