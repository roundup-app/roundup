import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { event } from "../testing/nodes";
import { message } from "../testing/centreFixture";
import { copy } from "./copy";
import {
  answers,
  FLOW_FILES,
  flowComparison,
  LOOKUP,
  RUN,
  TYPES_ONLY,
} from "./flowFixture";
import { flowName } from "./flows";
import { mountControl } from "./harness";
import { outdatedItem } from "./itemNotes";
import { notesFor } from "./notes";
import type { ItemNote } from "./notes";
import {
  noteList,
  openBatch,
  openChanges,
  openFirstModule,
  take,
  treeRow,
} from "./noteHarness";
import {
  chooseLens,
  comparison,
  counted,
  edited,
  fresh,
  moduleKeys,
  moduleRow,
  openPaths,
  press,
  region,
  setUpView,
} from "./viewHarness";

setUpView();

// U7691: a note on a module, a flow or a file, over the view and the fake App.

const present = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined)
    throw new Error("Expected a value");

  return value;
};

const file = (path: string, blob = "one"): ChangedFile => ({
  ...counted(path, 1, 1),
  blob: `${path}@${blob}`,
});

/** The blob each file lists now, and `undefined` for a file the change no longer lists; a test moves one to say the Agent wrote it. */
const blobs: Record<string, string | undefined> = {};

const listing = () => ({
  files: ["a/x.ts", "a/y.ts", "b/x.ts", "pnpm-lock.yaml"].flatMap((path) =>
    path in blobs && blobs[path] === undefined ? [] : [file(path, blobs[path])],
  ),
});

type Mounted = Awaited<ReturnType<typeof mountControl>>;

const open = async (project = fresh()) => {
  for (const key of Object.keys(blobs)) Reflect.deleteProperty(blobs, key);
  const mounted = await mountControl(listing, project);

  mounted.app.handlers["agent.compareFile"] = ({ path }) => comparison(path);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });

  return mounted;
};

const form = (kind: keyof typeof copy.noteOn) =>
  within(screen.getByRole("form", { name: copy.noteOn[kind] }));

const anyForm = () => document.querySelector("form.note-form");

const typed = (kind: keyof typeof copy.noteOn) =>
  form(kind).getByLabelText<HTMLTextAreaElement>(copy.note);

/** N on a list row waits for the pane's read, as a user's key does. */
const noteRow = async (row: HTMLElement, kind: keyof typeof copy.noteOn) => {
  take(row);
  await waitFor(() => {
    if (!screen.queryByRole("form", { name: copy.noteOn[kind] })) {
      row.focus();
      press("n", row);
    }

    form(kind);
  });
};

const write = (kind: keyof typeof copy.noteOn, text: string) => {
  fireEvent.input(typed(kind), { target: { value: text } });
  fireEvent.click(form(kind).getByRole("button", { name: copy.save }));

  return waitFor(() => {
    if (screen.queryByRole("form", { name: copy.noteOn[kind] }))
      throw new Error("Save is pending");
  });
};

/** A line note on the first drawn diff: N on it, as a user does. */
const lineNote = async (text: string) => {
  await waitFor(() => {
    const diff = present(document.querySelector<HTMLElement>(".diff-content"));

    diff.focus();
    fireEvent.keyDown(diff, { key: "n" });
    screen.getByRole("form", { name: copy.lineNote });
  });
  const line = within(screen.getByRole("form", { name: copy.lineNote }));

  fireEvent.input(line.getByLabelText(copy.note), { target: { value: text } });
  fireEvent.click(line.getByRole("button", { name: copy.save }));
  await waitFor(() => {
    if (screen.queryByRole("form", { name: copy.lineNote }))
      throw new Error("Save is pending");
  });
};

type Entry = { "User comment:"?: string };

const send = async (app: Mounted["app"], bodies: { notes: Entry[] }[] = []) => {
  app.handlers["message.send"] = (params) => {
    bodies.push(JSON.parse(params.body));

    return message(bodies.length, { to: params.to, body: params.body });
  };

  fireEvent.click(await screen.findByRole("button", { name: /Send notes:/ }));
  await waitFor(() => expect(bodies.length).toBeGreaterThan(0));

  return bodies;
};

const stored = (mounted: Mounted) =>
  notesFor(mounted.app, mounted.connected.project.path).all("a");

const state = () =>
  present(document.querySelector<HTMLElement>(".note-view")).dataset.state;

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Agent wrote: the view reads what it owns again. */
const written = async (mounted: Mounted) => {
  await mounted.connected.owned.refresh("a");
  await tick();
};

it("u7691a_the_rows_that_take_a_note_and_the_ones_that_do_not", async () => {
  await open();

  for (const row of [
    present(region().querySelector<HTMLElement>('[data-row="overview"]')),
    present(region().querySelector<HTMLElement>('[data-row="noise"]')),
  ]) {
    row.focus();
    press("n", row);
    expect(anyForm()).toBeNull();
  }

  await noteRow(moduleRow("a"), "module");
  press("Escape", typed("module"));
  await waitFor(() => expect(anyForm()).toBeNull());
  await noteRow(await treeRow("a/y.ts"), "file");
});

it("u7691a_the_header_icon_opens_the_form_under_the_header", async () => {
  await open();
  take(moduleRow("a"));
  fireEvent.click(
    await screen.findByRole("button", { name: copy.noteOn.module }),
  );
  await waitFor(() => expect(document.activeElement).toBe(typed("module")));
  press("Escape", typed("module"));
  await waitFor(() => expect(anyForm()).toBeNull());

  await waitFor(() => {
    const section = present(
      document.querySelector<HTMLElement>('.module-file[data-path="a/x.ts"]'),
    );

    fireEvent.click(
      within(section).getByRole("button", { name: copy.noteOn.file }),
    );
  });
  expect(typed("file")).toBeTruthy();
});

it("u7691a_closing_an_item_form_hands_focus_back_to_what_opened_it", async () => {
  await open();
  await noteRow(moduleRow("a"), "module");
  press("Escape", typed("module"));
  await waitFor(() => expect(document.activeElement).toBe(moduleRow("a")));
  const icon = await screen.findByRole("button", { name: copy.noteOn.module });

  fireEvent.click(icon);
  await write("module", "saved from the icon");
  await waitFor(() => expect(document.activeElement).toBe(icon));
});

it("u7691a_n_in_the_list_opens_an_item_note_and_n_in_the_diff_a_line_note", async () => {
  await open();
  await noteRow(await treeRow("a/x.ts"), "file");
  press("Escape", typed("file"));
  await waitFor(() => expect(anyForm()).toBeNull());
  take(moduleRow("a"));
  await waitFor(() => {
    const diff = present(document.querySelector<HTMLElement>(".diff-content"));

    diff.focus();
    fireEvent.keyDown(diff, { key: "n" });
    screen.getByRole("form", { name: copy.lineNote });
  });
});

it("u7691a_the_form_has_a_label_and_no_lines_or_replacement", async () => {
  await open();
  await noteRow(moduleRow("a"), "module");
  expect(form("module").getByRole("group", { name: copy.label })).toBeTruthy();
  expect(form("module").queryByRole("spinbutton")).toBeNull();
  expect(
    form("module").queryByRole("button", { name: copy.suggestChange }),
  ).toBeNull();
  expect(
    form("module")
      .getByRole("button", { name: copy.save })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  press("n", typed("module"));
  expect(document.querySelectorAll("form.note-form")).toHaveLength(1);
  fireEvent.input(typed("module"), { target: { value: "whole" } });
  fireEvent.keyDown(typed("module"), { key: "Enter", metaKey: true });
  await waitFor(() => expect(anyForm()).toBeNull());
  expect(state()).toBe("unsent");
});

it("u7691a_esc_keeps_typed_text_and_a_restart_restores_it", async () => {
  const project = fresh();
  const first = await open(project);

  await noteRow(moduleRow("a"), "module");
  fireEvent.input(typed("module"), { target: { value: "half" } });
  await waitFor(() =>
    expect(localStorage.getItem(`roundup:drafts:${project}`)).toContain("half"),
  );
  press("Escape", typed("module"));
  await waitFor(() => expect(anyForm()).toBeNull());
  expect(screen.queryByLabelText(/Unfinished work/)).toBeNull();
  first.view.unmount();
  await open(project);
  await noteRow(moduleRow("a"), "module");
  expect(typed("module").value).toBe("half");
});

it("u7691b_the_bar_counts_an_item_note_and_its_list_names_the_item", async () => {
  await open();
  await noteRow(moduleRow("a"), "module");
  await write("module", "whole module");
  await openBatch();
  const rows = present(noteList()).querySelectorAll("li");

  expect(rows).toHaveLength(1);
  expect(rows[0]?.textContent).toContain(copy.itemMeta("module", 2));
});

it("u7691b_one_message_holds_line_and_item_notes_with_a_group_line", async () => {
  const mounted = await open();

  await noteRow(moduleRow("a"), "module");
  await write("module", "m");
  await lineNote("l");
  await noteRow(await treeRow("a/y.ts"), "file");
  await write("file", "f");
  const [body] = await send(mounted.app);
  const [module, line, single] = present(body).notes;

  expect(module).toEqual({
    "Group:": { kind: "module", name: "a", files: ["a/x.ts", "a/y.ts"] },
    "Content revisions:": { "a/x.ts": "a/x.ts@one", "a/y.ts": "a/y.ts@one" },
    "User comment:": "m",
  });
  expect(single).toEqual({
    "Group:": { kind: "file", name: "a/y.ts", files: ["a/y.ts"] },
    "Content revisions:": { "a/y.ts": "a/y.ts@one" },
    "User comment:": "f",
  });
  expect(line).toHaveProperty("Lines:");
  expect(line).not.toHaveProperty("Group:");
});

it("u7691b_a_sent_item_note_stays_and_is_never_sent_twice", async () => {
  const mounted = await open();

  await noteRow(moduleRow("a"), "module");
  await write("module", "first");
  const bodies = await send(mounted.app);

  await waitFor(() => expect(stored(mounted)[0]?.sent).toBeTypeOf("number"));
  expect(state()).toBe("sent");
  await noteRow(moduleRow("b"), "module");
  await write("module", "second");
  await send(mounted.app, bodies);
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]?.notes.map((note) => note["User comment:"])).toEqual([
    "second",
  ]);
  expect(stored(mounted)).toHaveLength(2);
});

it("u7691b_records_saved_before_item_notes_still_load", async () => {
  const project = fresh();
  const first = await open(project);

  take(moduleRow("a"));
  await lineNote("old kind");
  await noteRow(moduleRow("a"), "module");
  await write("module", "new kind");
  await waitFor(() =>
    expect(localStorage.getItem(`roundup:drafts:${project}`)).toContain(
      "new kind",
    ),
  );
  first.view.unmount();
  const second = await open(project);

  await waitFor(() =>
    expect(
      stored(second).map((note) => ("item" in note ? note.item.kind : "line")),
    ).toEqual(["line", "module"]),
  );
  expect(stored(second).map((note) => note.text)).toEqual([
    "old kind",
    "new kind",
  ]);
});

it("u7691c_a_write_to_a_file_of_the_item_turns_a_sent_note_outdated_and_an_unrelated_write_does_not", async () => {
  const mounted = await open();

  await noteRow(moduleRow("a"), "module");
  await write("module", "module");
  await send(mounted.app);
  await waitFor(() => expect(state()).toBe("sent"));
  blobs["b/x.ts"] = "two";
  await written(mounted);
  expect(state()).toBe("sent");
  blobs["a/y.ts"] = "two";
  await written(mounted);
  await waitFor(() => expect(state()).toBe("outdated"));
});

it("u7691c_a_file_that_leaves_the_change_turns_a_sent_note_outdated", async () => {
  const mounted = await open();

  await noteRow(moduleRow("a"), "module");
  await write("module", "module");
  await send(mounted.app);
  await waitFor(() => expect(state()).toBe("sent"));
  blobs["a/y.ts"] = undefined;
  await written(mounted);
  await waitFor(() => expect(state()).toBe("outdated"));
});

it("u7691c_a_flow_note_reads_outdated_when_a_new_trace_or_readback_drops_its_flow", async () => {
  const mounted = await mountControl(() => ({ files: FLOW_FILES }), fresh());
  let trace = answers();

  mounted.app.handlers["agent.compareFile"] = ({ path }) =>
    flowComparison(path);
  mounted.app.handlers["agent.callPaths"] = (params) => trace(params);
  await openChanges();
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await chooseLens(copy.lenses.flows);
  const flow = flowName(RUN.key);

  await noteRow(await waitFor(() => moduleRow(flow)), "flow");
  await write("flow", "the run flow");
  await send(mounted.app);
  await waitFor(() => expect(state()).toBe("sent"));
  trace = ({ language }) => (language === "typescript" ? TYPES_ONLY : LOOKUP);
  edited(mounted.app, "a");
  mounted.app.emit(
    event({
      name: "agent.status",
      data: {
        id: "a",
        attempt: "1",
        status_revision: "2",
        status: { kind: "done", label: "done", since: 0, finished: "1" },
      },
    }),
  );
  await waitFor(() => expect(moduleKeys()).not.toContain("m:" + flow));
  await openFirstModule();
  press("g");
  await waitFor(() =>
    expect(
      present(screen.queryByRole("region", { name: copy.jumpToNote }))
        .textContent,
    ).toContain(copy.outdated),
  );

  // Before a trace or readback has finished the flow reads by its blob; a readback flow follows the same rule.
  const note: ItemNote = {
    id: 1,
    revision: "r",
    text: "t",
    sent: 1,
    item: {
      kind: "flow",
      name: "~read:r1",
      title: "r",
      blobs: { "a.ts": "x" },
    },
  };

  expect(
    outdatedItem(note, [{ ...file("a.ts"), blob: "x" }], () => undefined),
  ).toBe(false);
  expect(
    outdatedItem(note, [{ ...file("a.ts"), blob: "x" }], () => false),
  ).toBe(true);
});

it("u7691d_a_note_follows_its_module_across_lenses_and_its_flow_in_flows", async () => {
  await open();
  await noteRow(moduleRow("a"), "module");
  await write("module", "by name");
  await noteRow(await treeRow("b/x.ts"), "file");
  await write("file", "by file");
  await chooseLens(copy.lenses.logic);
  take(await waitFor(() => moduleRow("a")));
  await waitFor(() => expect(document.querySelectorAll(".note-view")).toHaveLength(1));
  take(await waitFor(() => moduleRow("b")));
  await waitFor(() => expect(openPaths()).toContain("b/x.ts"));
  expect(document.querySelectorAll(".note-view")).toHaveLength(1);
});

it("u7691d_the_row_counts_its_item_notes", async () => {
  await open();
  await noteRow(moduleRow("a"), "module");
  await write("module", "one");
  await noteRow(await treeRow("b/x.ts"), "file");
  await write("file", "two");
  await lineNote("a line note is not counted");
  expect(moduleRow("a").getAttribute("aria-label")).toContain(
    copy.noteCount(1),
  );
  expect(moduleRow("b").getAttribute("aria-label")).toContain(
    copy.noteCount(1),
  );
});

it("u7691d_the_jump_list_holds_item_notes_and_opens_their_first_file", async () => {
  await open();
  await noteRow(moduleRow("b"), "module");
  await write("module", "whole b");
  take(moduleRow("a"));
  await lineNote("line a");
  press("g", document.activeElement ?? region());
  const list = await screen.findByRole("combobox", { name: copy.jumpToNote });

  const rows = within(
    present(screen.queryByRole("region", { name: copy.jumpToNote })),
  ).queryAllByRole("option");

  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).not.toContain(copy.itemMeta("module", 1));
  fireEvent.click(present(rows[1]));
  expect(rows[1]?.textContent).toContain(copy.itemMeta("module", 1));
  await waitFor(() => expect(openPaths()).toContain("b/x.ts"));
  expect(list).toBeTruthy();
});
