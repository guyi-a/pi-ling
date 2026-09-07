import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { describe, expect, it } from "vitest";

import { toDshSeed } from "../src/index.js";

const canonicalHistory = [
  {
    id: "canonical-user-1",
    role: "user" as const,
    text: "My test code is ORANGE-42.",
  },
  {
    id: "canonical-assistant-1",
    role: "assistant" as const,
    text: "I will remember that code.",
    provider: "pi-ling-deepseek",
    model: "deepseek-v4-flash",
  },
];

describe("DSH transcript seed plugin", () => {
  it("projects canonical messages onto the DSH model surface", () => {
    const session = Session.create(
      SessionId("seed-projection"),
      toDshSeed(canonicalHistory, 1),
    );
    expect(
      session.deriveMessages().map((message) => ({
        id: message.id,
        role: message.role,
        text:
          message.content[0]?.type === "text"
            ? message.content[0].text
            : "",
      })),
    ).toEqual([
      {
        id: "canonical-user-1",
        role: "user",
        text: "My test code is ORANGE-42.",
      },
      {
        id: "canonical-assistant-1",
        role: "assistant",
        text: "I will remember that code.",
      },
    ]);
  });
});
