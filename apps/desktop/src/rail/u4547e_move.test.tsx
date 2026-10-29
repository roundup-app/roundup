import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountRail, railCallsTo, rowOf, chooseAction, settled } from "./railFixture";
import { captureActions } from "../keys/registry";

afterEach(() => { cleanup(); localStorage.clear(); });
const tree = () => [workstream("Research"), workstream("Review", { opening_prompt: "Review changes" }), agent("nested", "idle", "", { parent: "Review" }), agent("free", "working", "live")];

it.each(["menu", "key"])("u4547e_menu_and_key_move_to_either_container %s", async entry => {
  for (const parent of ["Research", "Review"]) {
    const nodes = tree();
    const m = await mountRail(nodes);
    m.rail.select("free");
    m.app.handlers["rail.move"] = params => {
      Object.assign(nodes[3]!, { parent: params.parent, order: params.index });
      m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
      return null;
    };
    const row = rowOf("free");
    row.focus();
    if (entry === "menu") await chooseAction(m.app, "free", "Move to…");
    else fireEvent.keyDown(row, { key: "m", code: "KeyM" });
    const input = await screen.findByRole("combobox");
    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["Research", "Review"]);
    fireEvent.input(input, { target: { value: parent } });
    await settled();
    fireEvent.click(screen.getByRole("option", { name: parent }));
    await m.rail.settled();
    await waitFor(() => expect(railCallsTo(m.app, "rail.move")).toEqual([{ id: "free", parent, index: parent === "Review" ? 1 : 0 }]));
    expect(m.rail.selected()).toBe("free");
    expect(m.rail.nodes.find(node => node.id === "free")).toMatchObject({ parent, terminal_id: "t-free", attempt: "1", status: { kind: "working", label: "live" } });
    expect(railCallsTo(m.app, "agent.spawn")).toEqual([]);
    expect(captureActions(rowOf("Research")).find(a => a.keys === "M")?.available()).toBe(false);
    cleanup();
  }
});

it("u4547e_failed_or_cancelled_move_keeps_the_original_home", async () => {
  const m = await mountRail(tree());
  const open = async () => {
    const row = rowOf("free"); row.focus();
    fireEvent.keyDown(row, { key: "m", code: "KeyM" });
    return screen.findByRole("combobox");
  };
  const input = await open();
  fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(rowOf("free")));
  expect(railCallsTo(m.app, "rail.move")).toEqual([]);
  m.app.handlers["rail.move"] = () => { throw new RpcError(-32003, "Move refused. Reopen the destination, then retry."); };
  await open();
  fireEvent.click(screen.getByRole("option", { name: "Research" }));
  await screen.findByText("Move refused. Reopen the destination, then retry.");
  expect(m.rail.nodes.find(node => node.id === "free")?.parent).toBeNull();
  m.app.handlers["rail.move"] = () => null;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(railCallsTo(m.app, "rail.move")).toEqual([{ id: "free", parent: "Research", index: 0 }, { id: "free", parent: "Research", index: 0 }]));
});
