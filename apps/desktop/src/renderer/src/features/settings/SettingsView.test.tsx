import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("renders an extensible appearance page with both themes", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        theme="dark"
        onThemeChange={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Settings categories");
    expect(html).toContain("Appearance");
    expect(html).toContain("Search Settings");
    expect(html).toContain("Models");
    expect(html).toContain("Cursor Dark");
    expect(html).toContain("Cursor Light");
  });
});
