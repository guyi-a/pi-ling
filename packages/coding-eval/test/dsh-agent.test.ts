import { describe, expect, it } from "vitest";

import { dshEvalAvailable } from "../src/agent-drivers/dsh-env.js";

describe("DshAgentDriver", () => {
  it("reports whether DSH eval prerequisites are available", () => {
    expect(typeof dshEvalAvailable()).toBe("boolean");
  });
});
