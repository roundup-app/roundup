import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";
import { agent, door, terminal, workstream } from "../testing/nodes";
import { progressSeed } from "../testing/progressSeed";

it.each(["pointer", "keyboard"])("u4453b_rail_menu_opens_progress_without_starting_work: %s", async input => {
  const seed = progressSeed({ project: "/p", agent: "a" });
  const { app } = await mountApp(fake => {
    fake.handlers["rail.tree"] = () => [agent("a", "done", "finished", { terminal_id: null }), door("r", "working", "working"), agent("b", "working", "working")];
    fake.handlers["message.progress"] = () => seed.progress;
    fake.handlers["message.reconcileWork"] = () => seed.plan;
  });
  for (const id of ["a", "r", "b", "a"]) {
    const row = document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;
    row.focus();
    if (input === "pointer") fireEvent.contextMenu(row);
    else fireEvent.keyDown(row, { key: "F10", code: "F10", shiftKey: true });
    await app.pickMenu("Work progress");
    await screen.findByRole("region", { name: "Progress" });
    expect(app.calls.filter(call => call.method === "message.progress").at(-1)?.params).toMatchObject({ id });
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Progress" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  }
  expect(app.calls.filter(call => ["message.send", "message.resumeWork", "agent.spawn", "agent.resume", "terminal.write", "agent.spawnPrompt"].includes(call.method))).toEqual([]);
});

it("u4453b_progress_menu_requires_an_agent", async () => {
  const { app } = await mountApp(fake => {
    fake.handlers["rail.tree"] = () => [terminal("a"), workstream("r"), agent("b", "done", "finished")];
  });
  for (const id of ["a", "r"]) {
    fireEvent.contextMenu(document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!);
    expect(app.shownMenus.at(-1)?.items.some(item => item.label === "Work progress")).toBe(false);
    await app.closeMenu();
  }
});
