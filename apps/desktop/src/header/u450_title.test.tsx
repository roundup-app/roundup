import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { openTabs } from "./stripFixture";

afterEach(cleanup);

it("u450_title_uses_the_selected_rows_workstream", async () => {
  const { app } = await openTabs({ api: [workstream("build", { name: "Build" }), agent("child", "idle", "ready", { parent: "build" })] });
  fireEvent.click(document.querySelector('[data-id="child"]')!);
  await waitFor(() => expect(document.querySelector('.window-title')?.textContent).toBe("api — Build"));
  await waitFor(() => expect(app.windowOperations).toContainEqual({ kind: "title", title: "api — Build" }));
});
