import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("renders theme and llm settings sections", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        theme="dark"
        onThemeChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("设置");
    expect(html).toContain("主题");
    expect(html).toContain("模型与 API");
    expect(html).toContain("正在加载配置");
  });
});
