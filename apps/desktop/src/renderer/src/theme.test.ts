import { describe, expect, it } from "vitest";

import { resolveInitialTheme } from "./theme";

describe("theme", () => {
  it("lets fixture query override persisted and system themes", () => {
    expect(
      resolveInitialTheme({
        search: "?fixture=long&theme=light",
        storedTheme: "dark",
        prefersDark: true,
      }),
    ).toBe("light");
  });

  it("uses the persisted preference before the system preference", () => {
    expect(
      resolveInitialTheme({
        search: "",
        storedTheme: "light",
        prefersDark: true,
      }),
    ).toBe("light");
  });

  it("falls back to the system preference", () => {
    expect(
      resolveInitialTheme({
        search: "",
        storedTheme: null,
        prefersDark: true,
      }),
    ).toBe("dark");
  });
});
