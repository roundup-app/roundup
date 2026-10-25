import { describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";

const found = chromePath();

(found ? describe : describe.skip)("u445 Chromium connection", () => {
  it("u445_closing_a_page_rejects_its_pending_call", async () => {
    const page = await openPage(found!);
    const pending = expect(page.call("() => new Promise(() => {})")).rejects.toThrow("Chrome exited before replying");

    try {
      await page.close();
    } finally {
      await pending;
    }
  }, 10_000);
});
