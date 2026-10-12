import { describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";

const found = chromePath();

(found ? describe : describe.skip)("u445 Chromium connection", () => {
  it("u445_a_stalled_call_is_bounded_and_a_fresh_page_answers", async () => {
    const page = await openPage(found!);

    try {
      await expect(page.call("() => { while (true) {} }")).rejects.toThrow("Runtime.callFunctionOn timed out");
    } finally {
      await page.close();
    }

    const fresh = await openPage(found!);

    try {
      expect(await fresh.call("() => 42")).toBe(42);
    } finally {
      await fresh.close();
    }
  }, 45_000);

  it("u445_closing_a_page_rejects_its_pending_call", async () => {
    const page = await openPage(found!);
    const pending = expect(page.call("() => new Promise(() => {})")).rejects.toThrow("Chrome exited before replying");
    await page.close();
    await pending;
  }, 10_000);
});
