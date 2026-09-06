import { describe, expect, it } from "vitest";

import { runPersistenceSmoke } from "./persistence-smoke.js";

describe("real persistence smoke", () => {
  it.skipIf(process.env["RUN_REAL_PERSISTENCE_SMOKE"] !== "1")(
    "continues model context after closing and reopening SQLite",
    async () => {
      const result = await runPersistenceSmoke();
      expect(result.answer.toLowerCase()).toContain("durable-kiwi");
      expect(result.messages).toBe(4);
      expect(result.persistedDeltas).toBe(0);
      expect(result.canonicalMessages).toBe(4);
      expect(result.liveUserMessages).toBe(2);
    },
    60_000,
  );
});
