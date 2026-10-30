import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { SendParams } from "@contracts/message/SendParams";
import { message } from "../testing/centreFixture";
import { COMPARISON, openDiff, openFile, saveNote } from "./noteHarness";
import { mountControl } from "./harness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2773c_changes_external_change_keeps_original", async () => {
  for (const project of ["/one", "/two"]) {
    const { view } = await openDiff(project);
    await saveNote(`  ${project} e\u0301\n🐝  `);
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: `unfinished ${project}\n  🐝` } });
    fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
    await waitFor(() => expect(localStorage.getItem(`roundup:drafts:${project}`)).toContain("unfinished"));
    view.unmount();
  }

  for (const project of ["/two", "/one"]) {
    const { app, view } = await mountControl(undefined, project);
    app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "external-revision", text: "external replacement\n" } });
    const send = vi.fn((params: SendParams) => message(1, { to: params.to, body: params.body }));
    app.handlers["message.send"] = send;
    fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));
    await openFile();
    const notes = screen.getByRole("list", { name: "Notes" });
    expect(notes.textContent).toContain(`  ${project} e\u0301\n🐝  `);
    await within(notes).findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", `unfinished ${project}\n  🐝`);
    expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
    expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
    await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
    const submitted = send.mock.calls[0]![0];
    expect(submitted).toMatchObject({ to: "a", kind: "note" });
    expect(JSON.parse(submitted.body)).toMatchObject({ notes: [
      { "File:": { old: "src/a.ts", new: "src/a.ts" }, "Base:": "base-commit", "Content revisions:": { old: "old-revision", new: "new-revision" }, "Lines:": "new 1-1", "Selected source:": "after", "User comment:": `  ${project} e\u0301\n🐝  ` },
      { "File:": { old: "src/a.ts", new: "src/a.ts" }, "Base:": "base-commit", "Content revisions:": { old: "old-revision", new: "new-revision" }, "Lines:": "new 1-2", "Selected source:": "after\nsecond new", "User comment:": `unfinished ${project}\n  🐝` },
    ] });
    expect(submitted.body).not.toContain("external replacement");
    expect(submitted.body).not.toContain("external-revision");
    view.unmount();
  }
});
