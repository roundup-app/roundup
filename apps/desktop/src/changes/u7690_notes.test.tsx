import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { message } from "../testing/centreFixture";
import { storageIdle } from "../state/storage";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openBatch, openChanges, openDiff, openFirstModule, startNote } from "./noteHarness";
import { NoteView } from "./NoteView";
import { notesFor } from "./notes";
import { isLine } from "./notes";
import type { Label, LineNote } from "./notes";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await storageIdle(); localStorage.clear(); });

const present = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected a value");

  return value;
};

const form = () => within(screen.getByRole("form", { name: copy.lineNote }));

const labels = () => within(form().getByRole("group", { name: copy.label }));

const suggest = () => form().queryByRole("button", { name: copy.suggestChange });

const replacementField = () => form().queryByLabelText<HTMLTextAreaElement>(copy.replacement);

const view = () => present(document.querySelector<HTMLElement>(".note-view"));

/** N waits for the pane's read, as a user's key does. */
const openForm = () => waitFor(() => { if (!screen.queryByRole("form", { name: copy.lineNote })) startNote(); form(); });

/** Writes a note through the composer: `change` runs on the open form, then Save. */
const compose = async (text: string, change: () => void = () => {}) => {
  await openForm();
  fireEvent.input(form().getByLabelText(copy.note), { target: { value: text } });
  change();
  fireEvent.click(form().getByRole("button", { name: copy.save }));
  await waitFor(() => { if (screen.queryByRole("form", { name: copy.lineNote })) throw new Error("Save is pending"); });
};

type Sent = { "Label:"?: string; "Replacement:"?: string; "User comment:": string; "Lines:": string };

const sendAll = async (app: Awaited<ReturnType<typeof openDiff>>["app"]) => {
  const bodies: { notes: Sent[] }[] = [];

  app.handlers["message.send"] = params => {
    bodies.push(JSON.parse(params.body));

    return message(1, { to: params.to, body: params.body });
  };

  fireEvent.click(await screen.findByRole("button", { name: /Send notes:/ }));
  await waitFor(() => expect(bodies).toHaveLength(1));

  return present(bodies[0]).notes;
};

const FIRST = "a.ts";

const LAST = "c.ts";

const NOTE: Omit<LineNote, "id" | "revision"> = { comparison: COMPARISON, side: "new", start: 51, end: 53, source: "after", text: "body" };

it("u7690a_the_composer_sets_and_clears_one_label", async () => {
  await openDiff();
  await openForm();
  const group = labels();
  const buttons = group.getAllByRole("button");
  const pressed = () => buttons.map(button => button.getAttribute("aria-pressed"));

  expect(buttons.map(button => button.textContent)).toEqual(["Question", "Nit", "Issue"]);
  expect(pressed()).toEqual(["false", "false", "false"]);
  fireEvent.click(group.getByRole("button", { name: "Question" }));
  fireEvent.click(group.getByRole("button", { name: "Nit" }));
  expect(pressed()).toEqual(["false", "true", "false"]);
  await compose("kept", () => {});
  fireEvent.mouseEnter(view());
  fireEvent.click(screen.getByRole("button", { name: copy.editTip }));
  await screen.findByRole("form", { name: copy.lineNote });
  expect(labels().getByRole("button", { name: "Nit" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(labels().getByRole("button", { name: "Nit" }));
  expect(labels().getAllByRole("button").map(button => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
});

it("u7690a_the_meta_line_names_the_label", () => {
  const sent = Date.now();
  const meta = (note: LineNote, status: "unsent" | "sent") => present(render(() => <NoteView note={note} status={status} edit={() => {}} remove={() => {}} />).container.querySelector(".note-meta")).textContent;
  const base = { ...NOTE, id: 1, revision: "r" };

  expect(meta({ ...base, label: "question" }, "unsent")).toBe(`${copy.newLines(51, 53)} · Question · ${copy.notSent}`);
  expect(meta({ ...base, label: "nit", sent }, "sent")).toBe(`${copy.newLines(51, 53)} · Nit · ${copy.sentAt(sent)}`);
  expect(meta(base, "unsent")).toBe(`${copy.newLines(51, 53)} · ${copy.notSent}`);
});

it("u7690a_a_labelled_note_sends_its_label_and_an_unlabelled_one_none", async () => {
  const { app } = await openDiff();

  await compose("first", () => fireEvent.click(labels().getByRole("button", { name: "Issue" })));
  await compose("second");
  await openBatch();
  const sent = await sendAll(app);

  expect(sent.map(note => note["Label:"])).toEqual(["issue", undefined]);
  expect("Label:" in present(sent[1])).toBe(false);
  expect(sent.map(note => note["User comment:"])).toEqual(["first", "second"]);
});

it("u7690b_the_field_opens_filled_with_the_selected_source", async () => {
  await openDiff();
  await openForm();
  fireEvent.input(form().getByRole("spinbutton", { name: copy.endLine }), { target: { value: "2" } });
  expect(replacementField()).toBeNull();
  fireEvent.click(present(suggest()));
  expect(present(replacementField()).value).toBe("after\nsecond new");
  fireEvent.click(present(suggest()));
  expect(replacementField()).toBeNull();
});

it("u7690b_the_old_side_offers_no_replacement", async () => {
  await openDiff();
  await openForm();
  expect(suggest()).not.toBeNull();
  fireEvent.click(form().getByRole("tab", { name: copy.oldSide }));
  expect(suggest()).toBeNull();
});

it("u7690b_a_replacement_reaches_the_message_and_an_unchanged_fill_sends_none", async () => {
  const { app } = await openDiff();
  const open = () => fireEvent.click(present(suggest()));
  const write = (value: string) => { open(); fireEvent.input(present(replacementField()), { target: { value } }); };

  await compose("edited", () => write("changed"));
  await compose("unchanged", open);
  await compose("emptied", () => write(""));
  await compose("plain");
  await openBatch();
  const sent = await sendAll(app);

  expect(sent.map(note => note["Replacement:"])).toEqual(["changed", undefined, "", undefined]);
  expect(sent.map(note => "Replacement:" in note)).toEqual([true, false, true, false]);
  expect(sent.map(note => note["Lines:"])).toEqual(["new 1-1", "new 1-1", "new 1-1", "new 1-1"]);
});

it("u7690b_a_saved_note_shows_its_replacement_and_edit_reopens_it", async () => {
  await openDiff();
  const better = "better\ncode";

  await compose("why", () => {
    fireEvent.click(present(suggest()));
    fireEvent.input(present(replacementField()), { target: { value: better } });
  });
  expect(present(view().querySelector("pre")).textContent).toBe(better);
  fireEvent.mouseEnter(view());
  fireEvent.click(screen.getByRole("button", { name: copy.editTip }));
  await screen.findByRole("form", { name: copy.lineNote });
  expect(present(replacementField()).value).toBe(better);
});

it("u7690b_labels_and_replacements_survive_a_restart_and_older_notes_still_load", async () => {
  const { view: first } = await openDiff();

  await compose("saved", () => {
    fireEvent.click(labels().getByRole("button", { name: "Nit" }));
    fireEvent.click(present(suggest()));
    fireEvent.input(present(replacementField()), { target: { value: "changed" } });
  });
  await openForm();
  fireEvent.input(form().getByLabelText(copy.note), { target: { value: "unfinished" } });
  fireEvent.click(labels().getByRole("button", { name: "Issue" }));
  await waitFor(() => expect(localStorage.getItem("roundup:drafts:/p")).toContain("issue"));
  first.unmount();
  const { app, connected } = await openDiff();
  const [restored] = notesFor(app, connected.project.path, connected.drafts).all("a").filter(isLine);

  expect([restored?.label, restored?.replacement]).toEqual(["nit", "changed"]);
  await openForm();
  expect(labels().getByRole("button", { name: "Issue" }).getAttribute("aria-pressed")).toBe("true");
  expect(form().getByLabelText<HTMLTextAreaElement>(copy.note).value).toBe("unfinished");
});

const gone = (path: string): FileComparison => ({ ...COMPARISON, oldPath: path, newPath: path });

/** Three changed files with unsent notes seeded across them, in no order. */
const jumpable = async () => {
  const files = ["a.ts", "b.ts", "c.ts"].map(path => ({ path, status: "modified" as const, line: 1, counts: null, blob: null }));
  const mounted = await mountControl(() => ({ files }), "/p");

  mounted.app.handlers["agent.compareFile"] = ({ path }) => gone(path);
  await openChanges();
  await openFirstModule();
  await screen.findByRole("region", { name: copy.changes });
  await waitFor(() => { if (!document.querySelector(".diff-content")) throw new Error("No diff yet"); });
  await new Promise(resolve => setTimeout(resolve, 50));
  const store = notesFor(mounted.app, "/p");

  const seed = (path: string, start: number, label?: Label, side: "old" | "new" = "new") => {
    const note = { ...NOTE, comparison: gone(path), side, start, end: start, text: `note ${path} ${start}` };

    return store.save("a", label === undefined ? note : { ...note, label });
  };

  await seed("c.ts", 1);
  await seed("b.ts", 1, "question", "new");
  await seed("a.ts", 2);
  await seed("b.ts", 1, undefined, "old");
  await seed("a.ts", 1, "nit");

  return { ...mounted, seed };
};

const region = () => screen.getByRole("region", { name: copy.changes });

const press = (key: string, target: Element = region()) => fireEvent.keyDown(target, { key });

const jumpList = () => screen.queryByRole("region", { name: copy.jumpToNote });

const rows = () => within(present(jumpList())).queryAllByRole("option").map(row => [...row.querySelectorAll("span")].map(part => part.textContent).join(" | "));

/** The file the module's scroll is at: the section holding focus, else the first. */
const openPath = () => (document.activeElement?.closest<HTMLElement>(".module-file") ?? document.querySelector<HTMLElement>(".module-file"))?.dataset.path;

const isOpen = (path: string) => waitFor(() => { if (openPath() !== path) throw new Error(`Not on ${path}`); });

it("u7690c_the_keys_list_gains_g", async () => {
  await jumpable();
  press("?");
  const items = within(await screen.findByRole("region", { name: copy.keys })).getAllByRole("listitem").map(item => item.textContent ?? "");

  expect(items.some(item => /^G\b/.test(item))).toBe(true);
});

it("u7690c_the_list_holds_every_note_in_file_order_whatever_its_state", async () => {
  const { seed } = await jumpable();

  await seed("gone.ts", 1);
  press("g");
  await screen.findByRole("region", { name: copy.jumpToNote });
  const texts = rows();

  expect(texts).toEqual([
    "a.ts | Line 1 · Nit · Not sent | note a.ts 1",
    "a.ts | Line 2 · Not sent | note a.ts 2",
    "b.ts | Old line 1 · Not sent | note b.ts 1",
    "b.ts | Line 1 · Question · Not sent | note b.ts 1",
    "c.ts | Line 1 · Not sent | note c.ts 1",
    "gone.ts | Line 1 · Not sent · No longer changed | note gone.ts 1",
  ]);
});

it("u7690c_g_then_enter_steps_from_note_to_note_across_files_and_wraps", async () => {
  await jumpable();
  const visited: string[] = [];
  // The focused line is a.ts line 1, so the first jump goes past its note: a 2, b old 1, b 1, c 1, then round to a 1.
  const want = ["a.ts", "b.ts", "b.ts", "c.ts", "a.ts", "a.ts"];

  for (const path of want) {
    // Keys follow focus: the diff holds it once the jump has drawn its file.
    press("g", document.activeElement ?? region());
    press("Enter", await screen.findByRole("combobox", { name: copy.jumpToNote }));
    await waitFor(() => { if (jumpList()) throw new Error("The list is open"); });
    await waitFor(() => { if (openPath() !== path || !document.activeElement?.classList.contains("diff-content")) throw new Error(`Not on ${path} yet:`); });
    visited.push(`${openPath()}`);
  }

  expect(visited).toEqual(want);
});

it("u7690c_a_click_chooses_and_escape_closes_without_moving", async () => {
  await jumpable();
  press("g");
  press("Escape", await screen.findByRole("combobox", { name: copy.jumpToNote }));
  await waitFor(() => expect(jumpList()).toBeNull());
  expect(region().contains(document.activeElement)).toBe(true);
  await isOpen(FIRST);
  press("g");
  await screen.findByRole("region", { name: copy.jumpToNote });
  fireEvent.click(within(present(jumpList())).getByText("note c.ts 1"));
  await isOpen(LAST);
  expect(jumpList()).toBeNull();
});

it("u7690c_with_no_notes_g_does_nothing", async () => {
  await openDiff();
  press("g");
  expect(jumpList()).toBeNull();
});

it("u7690c_a_note_whose_file_left_the_change_is_listed_and_cannot_be_chosen", async () => {
  const { seed } = await jumpable();

  await seed("gone.ts", 1);
  press("g");
  const input = await screen.findByRole("combobox", { name: copy.jumpToNote });

  fireEvent.click(within(present(jumpList())).getByText("note gone.ts 1"));
  expect(jumpList()).not.toBeNull();
  expect(rows().at(-1)).toContain(copy.noLongerChanged);
  expect(input.isConnected).toBe(true);
  await isOpen(FIRST);
});
