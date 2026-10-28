import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

it("a4452c_the_row_menu_opens_only_the_named_workstreams_prompt", async () => {
  const m = await mountRail([workstream("w", { name: "Plan" }), agent("a", "idle", "", { parent: "w" })]);
  m.rail.select("a");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.contextMenu(rowOf("a"));
  expect(m.app.menuLabels()).not.toContain("Opening prompt…");
  fireEvent.contextMenu(rowOf("Plan"));
  await m.app.pickMenu("Opening prompt…");
  await screen.findByRole("dialog", { name: "Opening prompt · Plan" });
  m.app.handlers["workstream.setOpeningPrompt"] = () => null;
  const field = await screen.findByRole("textbox", { name: "Opening prompt" });
  fireEvent.input(field, { target: { value: "Read the plan" } });
  expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toEqual([]);
  fireEvent.blur(field);
  await waitFor(() => expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toEqual([{ id: "w", prompt: "Read the plan" }]));
});

it("a4452c_a_refused_opening_prompt_keeps_the_original_workstream_draft", async () => {
  const m = await mountRail([workstream("w"), workstream("other")], [], undefined, () => true);
  m.app.handlers["workstream.setOpeningPrompt"] = () => { throw new RpcError(-32003, "Save failed; retry"); };

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("Opening prompt…");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Opening prompt" });
  fireEvent.input(field, { target: { value: "  /compose exact words\n" } });
  fireEvent.blur(field);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.contextMenu(rowOf("other"));
  await m.app.pickMenu("Opening prompt…");
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Opening prompt" })).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu("Opening prompt…");
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Opening prompt" })).value).toBe("  /compose exact words\n");
});
