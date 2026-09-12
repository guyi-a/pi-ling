import { describe, expect, it } from "vitest";

import {
  buildDshPiAiProfilePatch,
  resolveDshAcpModel,
} from "../src/dsh-pi-ai-profile.js";

describe("resolveDshAcpModel", () => {
  it("maps pi-ling deepseek-flash to pi-ai deepseek-v4-pro for DSH", () => {
    expect(resolveDshAcpModel("deepseek", "deepseek-flash")).toBe(
      "deepseek-v4-pro",
    );
  });

  it("passes through other provider models unchanged", () => {
    expect(resolveDshAcpModel("anthropic", "claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });
});

describe("buildDshPiAiProfilePatch", () => {
  it("writes the resolved model into the ACP profile", () => {
    const patch = buildDshPiAiProfilePatch({
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(patch).toContain("model: deepseek-v4-pro");
    expect(patch).not.toContain("model: deepseek-flash");
  });
});
