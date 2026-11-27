import { notesFor } from "./notes";
import { copy } from "./copy";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { NoteView } from "./NoteView";
import { message } from "../testing/centreFixture";
import { COMPARISON, noteList, openDiff, openFile, saveNote, startNote } from "./noteHarness";
import { afterEach, expect, it, vi } from "vitest";
import { storageIdle } from "../state/storage";

// The pane's read lands after its element (U7678d reads a module's first file at mount): N waits for it, as a user's key does.
const beginNote = () => waitFor(() => { if (!screen.queryByRole("form", { name: "Line note" })) startNote(); screen.getByRole("form", { name: "Line note" }); });

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await storageIdle(); localStorage.clear(); });

const present = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected a value");

  return value;
};

const noted = () => [...document.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line][data-noted]") ?? []].map(line => line.getAttribute("data-line"));

const view = () => present(document.querySelector<HTMLElement>(".note-view"));

const form = () => within(screen.getByRole("form", { name: copy.lineNote }));

const field = () => form().getByLabelText<HTMLTextAreaElement>(copy.note);

const bar = () => screen.getByLabelText(copy.notesRegion, { selector: "section" });

const send = (app: Awaited<ReturnType<typeof openDiff>>["app"], bodies: string[] = []) => {
  app.handlers["message.send"] = params => {
    bodies.push(params.body);

    return message(1, { to: params.to, body: params.body });
  };

  fireEvent.click(within(bar()).getByRole("button", { name: /Send notes:/ }));
};

const sendOne = async (text = "submitted") => {
  const mounted = await openDiff();
  await saveNote(text);
  send(mounted.app);
  await waitFor(() => expect(notesFor(mounted.app, "/p").all("a")[0]?.sent).toBeTypeOf("number"));

  return mounted;
};

it("u7677a_noted_lines_keep_their_marker_after_save", async () => {
  const { app } = await openDiff();
  await saveNote("kept");
  await waitFor(() => expect(noted()).toEqual(["1"]));
  fireEvent.mouseEnter(view());
  fireEvent.click(screen.getByRole("button", { name: copy.removeTip }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")).toEqual([]));
  await waitFor(() => expect(noted()).toEqual([]));
});

it("u7677a_the_note_sits_in_the_diff_surface_and_the_bar_in_the_app_theme", async () => {
  await openDiff();
  await saveNote("kept");
  expect(view().closest("[data-surface='diff']")).toBe(view());
  expect(bar().closest("[data-surface]")).toBeNull();
});

it("u7677b_a_saved_note_shows_body_then_one_meta_line", async () => {
  const { app } = await openDiff();
  const body = "body";

  await saveNote(body);
  const meta = present(view().querySelector(".note-meta"));
  const [saved] = notesFor(app, "/p").all("a");

  expect(saved?.text).toBe(body);
  expect(view().firstElementChild?.textContent).toBe(saved?.text);
  expect(meta.textContent).toBe(`${copy.newLine(1)} · ${copy.notSent}`);

  cleanup();

  // A range reads "Lines 51-53", a single line "Line 51", the old side "Old lines 4-6" (U7677b).
  for (const [side, start, end, words] of [["new", 51, 53, copy.newLines(51, 53)], ["new", 51, 51, copy.newLine(51)], ["old", 4, 6, copy.oldLines(4, 6)], ["old", 4, 4, copy.oldLine(4)]] as const) {
    const shown = render(() => <NoteView note={{ ...present(saved), side, start, end }} status="unsent" edit={() => {}} remove={() => {}} />);

    expect(present(shown.container.querySelector(".note-meta")).textContent).toBe(`${words} · ${copy.notSent}`);
    shown.unmount();
  }
});

it("u7677b_a_long_note_folds_behind_show_all", async () => {
  await openDiff();
  const six = ["1", "2", "3", "4", "5", "6"];
  const seven = [...six, "7"];

  await saveNote(six.join("\n"));
  expect(within(view()).queryByRole("button", { name: copy.showAll })).toBeNull();
  cleanup();
  localStorage.clear();
  await openDiff();
  await saveNote(seven.join("\n"));
  expect(present(view().querySelector(".note-body")).textContent).toBe(six.join("\n"));
  fireEvent.click(within(view()).getByRole("button", { name: copy.showAll }));
  expect(present(view().querySelector(".note-body")).textContent).toBe(seven.join("\n"));
});

it("u7677c_edit_and_remove_appear_on_hover_or_focus_with_key_tooltips", async () => {
  await openDiff();
  await saveNote("kept");
  expect(screen.queryByRole("button", { name: copy.editTip })).toBeNull();
  expect(screen.queryByRole("button", { name: copy.removeTip })).toBeNull();
  fireEvent.mouseEnter(view());
  expect(screen.getByRole("button", { name: copy.editTip })).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.removeTip })).toBeTruthy();
  fireEvent.mouseLeave(view());
  expect(screen.queryByRole("button", { name: copy.editTip })).toBeNull();
  fireEvent.focusIn(view());
  expect(screen.getByRole("button", { name: copy.editTip })).toBeTruthy();
});

it("u7677c_clicking_the_text_edits_and_the_buttons_edit_and_remove", async () => {
  const { app } = await openDiff();
  await saveNote("kept");
  fireEvent.click(present(view().querySelector(".note-body")));
  expect(field().value).toBe("kept");
  fireEvent.keyDown(field(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull());
  fireEvent.mouseEnter(view());
  fireEvent.click(screen.getByRole("button", { name: copy.editTip }));
  expect(field().value).toBe("kept");
  fireEvent.keyDown(field(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull());
  fireEvent.mouseEnter(view());
  fireEvent.click(screen.getByRole("button", { name: copy.removeTip }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")).toEqual([]));
  await screen.findByText(copy.noteRemoved);
  fireEvent.click(screen.getByRole("button", { name: copy.undo }));
  await waitFor(() => expect(notesFor(app, "/p").all("a")).toHaveLength(1));
});

it("u7677d_the_field_grows_to_twelve_lines_then_scrolls", async () => {
  await openDiff();
  await beginNote();
  fireEvent.input(field(), { target: { value: "1\n2\n3\n4" } });
  await waitFor(() => expect(field().rows).toBe(4));
  fireEvent.input(field(), { target: { value: Array.from({ length: 30 }, (_, at) => `${at}`).join("\n") } });
  await waitFor(() => expect(field().rows).toBe(12));
});

it("u7677d_focus_is_marked_by_the_note_attribute", async () => {
  await openDiff();
  await beginNote();
  const note = screen.getByRole("form", { name: copy.lineNote });

  fireEvent.focusIn(field());
  expect(note.hasAttribute("data-focused")).toBe(true);
  await waitFor(() => expect(document.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line][data-focused]")).not.toBeNull());
  fireEvent.focusOut(field(), { relatedTarget: document.body });
  expect(note.hasAttribute("data-focused")).toBe(false);
});

it("u7677d_save_is_disabled_while_the_field_is_empty", async () => {
  await openDiff();
  await beginNote();
  expect(form().getByText(copy.saveHint)).toBeTruthy();
  expect(form().getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.input(field(), { target: { value: "text" } });
  await waitFor(() => expect(form().getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).not.toBe("true"));
});

it("u7677e_acceptance_marks_the_submitted_notes_waiting_and_keeps_them", async () => {
  const mounted = await openDiff();

  await saveNote("submitted");
  mounted.app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body, status: "pending" });
  fireEvent.click(within(bar()).getByRole("button", { name: /Send notes:/ }));
  const { app } = mounted;
  await waitFor(() => expect(notesFor(app, "/p").all("a")[0]?.sent).toBeTypeOf("number"));
  const [kept] = notesFor(app, "/p").all("a");

  expect(kept?.text).toBe("submitted");
  await waitFor(() => expect(view().getAttribute("data-state")).toBe("waiting"));
  expect(present(view().querySelector(".note-meta")).textContent).toBe(`${copy.newLine(1)} · ${copy.waiting}`);
  await screen.findByText("Sent 1 note to a");
  await saveNote("added meanwhile");
  expect(notesFor(app, "/p").list("a").map(note => note.text)).toEqual(["added meanwhile"]);
});

it("u7677e_a_sent_note_is_never_sent_twice", async () => {
  const { app } = await sendOne();

  expect(notesFor(app, "/p").list("a")).toEqual([]);
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
  await saveNote("second");
  const bodies: string[] = [];

  send(app, bodies);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
  expect(bodies[0]).toContain("second");
  expect(bodies[0]).not.toContain("submitted");
});

it("u7677e_a_rewrite_over_the_lines_turns_a_sent_note_outdated_and_folded", async () => {
  const lines = ["first", "second"];
  const { app, connected } = await sendOne(lines.join("\n"));

  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "same-lines", text: "after\nrest\n" } });
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(noted()).toEqual(["1"]));
  expect(view().getAttribute("data-state")).toBe("sent");
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "rewritten", text: "rewritten\nafter\n" } });
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(view().getAttribute("data-state")).toBe("outdated"));
  expect(present(view().querySelector(".note-meta")).textContent).toContain(copy.outdated);
  expect(present(view().querySelector(".note-body")).textContent).toBe(lines[0]);
  fireEvent.click(within(view()).getByRole("button", { name: copy.showAll }));
  expect(present(view().querySelector(".note-body")).textContent).toBe(lines.join("\n"));
});

it("u7677e_sent_notes_return_marked_sent_after_a_restart", async () => {
  const first = await sendOne();

  await storageIdle();
  first.view.unmount();
  const next = await openDiff("/p", first.connected.drafts);

  expect(notesFor(next.app, "/p").all("a").map(note => note.sent !== undefined)).toEqual([true]);
  expect(notesFor(next.app, "/p").list("a")).toEqual([]);
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
});

it("u7677e_no_control_clears_sent_notes", async () => {
  await sendOne();
  await waitFor(() => expect(view().getAttribute("data-state")).toBe("sent"));
  fireEvent.mouseEnter(view());
  expect(screen.getAllByRole("button").map(button => button.getAttribute("aria-label")).filter(label => /clear/i.test(label ?? ""))).toEqual([]);
  expect(screen.queryByRole("button", { name: copy.editTip })).toBeNull();
  expect(screen.getByRole("button", { name: copy.removeTip })).toBeTruthy();
  expect(noteList()).toBeNull();
  await openFile();
});
