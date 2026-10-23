import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

afterEach(cleanup);

it("u451_empty_space_requests_drag", async () => {
  const { app } = await openTabs({ api: [] });
  fireEvent.mouseDown(document.querySelector('.window-bar')!, { button: 0, detail: 1 });
  expect(app.windowOperations).toContainEqual({ kind: "drag" });
});

it("u451_empty_space_double_click_requests_zoom", async () => {
  const { app } = await openTabs({ api: [] });
  fireEvent.mouseDown(document.querySelector('.window-bar')!, { button: 0, detail: 2 });
  expect(app.windowOperations).toContainEqual({ kind: "zoom" });
});

it("u451_controls_do_not_drag_or_zoom", async () => {
  const { app } = await openTabs({ api: [] });

  for (const control of document.querySelectorAll('.window-bar button, .traffic-lights')) {
    fireEvent.mouseDown(control, { button: 0, detail: 1 });
    fireEvent.mouseDown(control, { button: 0, detail: 2 });
    fireEvent.dblClick(control, { button: 0 });
  }

  fireEvent.dblClick(tab("api").querySelector('.tab-name')!);
  const input = document.querySelector('.tab-rename')!;
  fireEvent.mouseDown(input, { button: 0, detail: 1 });
  fireEvent.mouseDown(input, { button: 0, detail: 2 });
  fireEvent.dblClick(input, { button: 0 });
  expect(app.windowOperations.filter((operation) => operation.kind !== "title")).toEqual([]);
  expect(input).toBeTruthy();
});
