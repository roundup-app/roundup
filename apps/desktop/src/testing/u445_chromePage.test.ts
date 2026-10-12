import { describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";

const found = chromePath();

(found ? describe : describe.skip)("u445 Chromium connection", () => {
  it("u445_a_stalled_call_is_bounded_and_the_page_closes", async () => {
    const page = await openPage(found!);
    try {
      await expect(page.call("() => new Promise(() => {})")).rejects.toThrow("Runtime.callFunctionOn timed out");
    } finally {
      await page.close();
    }
  }, 45_000);
});
