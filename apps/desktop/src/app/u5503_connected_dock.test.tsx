import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs } from "../header/stripFixture";
import { agent } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each([0, 1, 5, 6, 8, 10])("u5503_five_rows_share_one_limit (%s)", async count => {
  const { app } = await openTabs({ api: Array.from({ length: count }, (_, index) => agent(String(index), "needs-you", "question")) });
  await waitFor(() => expect(app.menuBar?.dock).toBeDefined());
  expect(app.menuBar?.dock.flatMap(entry => entry.action?.kind === "agent" ? [entry.action.agent] : [])).toEqual(Array.from({ length: Math.min(count, 5) }, (_, index) => String(index)));
  expect(app.menuBar?.dock.filter(entry => entry.action?.kind === "open")).toHaveLength(count > 5 ? 2 : 1);
  expect(app.menuBar?.dock.filter(entry => entry.action === null)).toHaveLength(1);
});
