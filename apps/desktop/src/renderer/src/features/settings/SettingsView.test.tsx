import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("renders theme settings only", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        theme="dark"
        onThemeChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("设置");
    expect(html).toContain("主题");
    expect(html).toContain("深色");
    expect(html).toContain("浅色");
    expect(html).not.toContain("Search Settings");
    expect(html).not.toContain("Models");
  });
});
