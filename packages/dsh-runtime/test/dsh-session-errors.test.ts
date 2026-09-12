import { describe, expect, it } from "vitest";

import {
  isDshSessionNotResumableError,
  isDshStaleSessionImportError,
} from "../src/dsh-session-errors.js";

describe("dsh session errors", () => {
  it("detects persistence-not-found import failures", () => {
    expect(
      isDshStaleSessionImportError(
        new Error(
          'SessionPersistenceNotFoundError: session "abc" not found',
        ),
      ),
    ).toBe(true);
  });

  it("treats not-resumable as stale import", () => {
    expect(
      isDshStaleSessionImportError(
        new Error("session is not resumable: abc"),
      ),
    ).toBe(true);
    expect(isDshSessionNotResumableError(new Error("network down"))).toBe(
      false,
    );
  });
});
