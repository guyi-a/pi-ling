import { describe, expect, it, beforeEach } from "vitest";

import {
  toContextSnippets,
  useComposerContextStore,
} from "./composer-context-store";

const S = "session-1";

describe("composer context store", () => {
  beforeEach(() => {
    useComposerContextStore.getState().clear(S);
  });

  it("stores an added snippet and assigns an id", () => {
    useComposerContextStore
      .getState()
      .add(S, { text: "hello", source: { kind: "chat", label: "对话记录" } });
    const pending = toContextSnippets(S);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe("hello");
    expect(pending[0]?.id).toBeTruthy();
  });

  it("keeps snippets in the order they were added", () => {
    const { add } = useComposerContextStore.getState();
    add(S, { text: "first" });
    add(S, { text: "second" });
    expect(toContextSnippets(S).map((s) => s.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("ignores an exact duplicate so double-clicks do not double the text", () => {
    const { add } = useComposerContextStore.getState();
    const source = { kind: "chat" as const, label: "对话记录" };
    add(S, { text: "same", source });
    add(S, { text: "same", source });
    expect(toContextSnippets(S)).toHaveLength(1);
  });

  it("allows the same text from a different source", () => {
    const { add } = useComposerContextStore.getState();
    add(S, { text: "same", source: { kind: "chat", label: "对话记录" } });
    add(S, { text: "same", source: { kind: "file", label: "a.ts:1" } });
    expect(toContextSnippets(S)).toHaveLength(2);
  });

  it("removes by id", () => {
    const { add } = useComposerContextStore.getState();
    add(S, { text: "a" });
    add(S, { text: "b" });
    const first = toContextSnippets(S)[0]!;
    useComposerContextStore.getState().remove(S, first.id);
    expect(toContextSnippets(S).map((s) => s.text)).toEqual(["b"]);
  });

  it("clears the whole session bucket", () => {
    const { add, clear } = useComposerContextStore.getState();
    add(S, { text: "a" });
    add(S, { text: "b" });
    clear(S);
    expect(toContextSnippets(S)).toEqual([]);
  });

  it("isolates sessions from each other", () => {
    const { add } = useComposerContextStore.getState();
    add(S, { text: "mine" });
    add("session-2", { text: "theirs" });
    expect(toContextSnippets(S).map((s) => s.text)).toEqual(["mine"]);
    expect(toContextSnippets("session-2").map((s) => s.text)).toEqual([
      "theirs",
    ]);
  });
});
