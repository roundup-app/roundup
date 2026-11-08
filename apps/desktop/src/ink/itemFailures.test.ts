import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createItemFailures } from "./itemFailures";

describe("P3557c: a failure belongs to its item", () => {
  it("vanishes when the key leaves, stays gone when it returns, and survives unknown", () => {
    createRoot(dispose => {
      const [present, setPresent] = createSignal<readonly string[] | "unknown">(["a", "b"]);
      const failures = createItemFailures(present);

      failures.fail("a", "no space");
      expect(failures.failure("a")).toBe("no space");
      expect(failures.failure("b")).toBeUndefined();

      setPresent("unknown");
      expect(failures.failure("a")).toBe("no space");

      setPresent(["b"]);
      expect(failures.failure("a")).toBeUndefined();

      setPresent(["a", "b"]);
      expect(failures.failure("a")).toBeUndefined();

      failures.fail("a", "again");
      failures.clear("a");
      expect(failures.failure("a")).toBeUndefined();
      dispose();
    });
  });
});
