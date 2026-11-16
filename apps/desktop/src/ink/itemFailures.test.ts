import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createItemFailures } from "./itemFailures";

describe("P3557c: a failure belongs to its item", () => {
  it("vanishes when the key leaves, stays gone when it returns, and survives unknown", () => {
    const [present, setPresent] = createSignal<readonly string[] | "unknown">(["a", "b"]);
    // Writes come from handlers, outside the owner that built the failures.
    const { failures, dispose } = createRoot(dispose => ({ failures: createItemFailures(present), dispose }));

    failures.fail("a", "no space");
    flush();
    expect(failures.failure("a")).toBe("no space");
    expect(failures.failure("b")).toBeUndefined();

    setPresent("unknown");
    flush();
    expect(failures.failure("a")).toBe("no space");

    setPresent(["b"]);
    flush();
    expect(failures.failure("a")).toBeUndefined();

    setPresent(["a", "b"]);
    flush();
    expect(failures.failure("a")).toBeUndefined();

    failures.fail("a", "again");
    failures.clear("a");
    flush();
    expect(failures.failure("a")).toBeUndefined();
    dispose();
  });
});
