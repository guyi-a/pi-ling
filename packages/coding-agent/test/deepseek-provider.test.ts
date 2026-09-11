import { createModels } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  PI_LING_DEEPSEEK_MODEL,
  PI_LING_DEEPSEEK_PROVIDER,
  registerPiLingDeepseekProvider,
} from "../src/deepseek-provider.js";

describe("registerPiLingDeepseekProvider", () => {
  it("registers deepseek-flash for pi-ling defaults", () => {
    const models = createModels();
    registerPiLingDeepseekProvider(models);

    const model = models.getModel(
      PI_LING_DEEPSEEK_PROVIDER,
      PI_LING_DEEPSEEK_MODEL,
    );
    expect(model).toBeDefined();
    expect(model?.id).toBe("deepseek-flash");
    expect(model?.input).toContain("image");
  });

  it("is idempotent", () => {
    const models = createModels();
    registerPiLingDeepseekProvider(models);
    registerPiLingDeepseekProvider(models);

    const listed = models
      .getModels(PI_LING_DEEPSEEK_PROVIDER)
      .filter((model) => model.id === PI_LING_DEEPSEEK_MODEL);
    expect(listed).toHaveLength(1);
  });
});
