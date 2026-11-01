import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { CHORDS, SWITCHER_KEYS } from "../keys/chords";
import { saveAppSettings, appSettings } from "../settings/preferences";
import { agent, info, USER, workstream } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher, switcherKey } from "./switcherFixture";

afterEach(async () => { cleanup(); await saveAppSettings({ shortcuts: {}, quickAdd: "meta+shift+KeyT" }); localStorage.clear(); sessionStorage.clear(); });

// SAFETY: every name passed is one of the table's own rows.
const chord = (name: string) => CHORDS.find(row => row.name === name)!;

const todo = (id: number, title: string, home: string | null = null): Todo => ({ id, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator: USER, home, owner: null, refs: [], priority: null });

const pad = (name: string, home: string | null = null): Pad => ({ incarnation: `i-${name}`, name, text: "", updated_at: 0, revision: 1, home });

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.switcher [role="option"]')];

const recordingMark = () => document.querySelector(".switcher-recording");

const footer = (): string[] => [...document.querySelectorAll(".switcher-footer kbd")].map(chip => chip.textContent!);

const search = async (text: string) => {
  fireEvent.input(field()!, { target: { value: text } });
  await waitFor(() => expect(field()!.value).toBe(text));
};

const direct = (target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  switcherKey("P", { metaKey: true, shiftKey: true, ...init }, target);

const waitOpen = async () => {
  await waitFor(() => expect(field()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

const terminalField = () => {
  const textarea = document.body.appendChild(document.createElement("textarea"));
  const reached: string[] = [];

  textarea.className = "xterm-helper-textarea";
  textarea.addEventListener("keydown", event => reached.push(event.code));
  textarea.focus();

  return { textarea, reached };
};

it("u5240a_the_direct_chord_opens_the_switcher_from_a_terminal", async () => {
  await mountSwitcher();
  const { textarea, reached } = terminalField();

  const press = direct(textarea);

  expect(press.defaultPrevented).toBe(true);
  await waitOpen();
  expect(reached).toEqual([]);

  direct(field()!, { repeat: true });
  expect(field()).not.toBeNull();
  direct(field()!);
  await waitFor(() => expect(field()).toBeNull());
  textarea.remove();
});

it("u5240a_leader_k_still_opens_it_and_no_modal_opens_a_second", async () => {
  await mountSwitcher();
  direct(document.body, { altKey: true });
  expect(field()).toBeNull();
  openSwitcher();
  await waitOpen();
  expect(document.querySelectorAll(".switcher")).toHaveLength(1);
  switcherKey("Escape", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  direct();
  await waitOpen();
  expect(document.querySelectorAll(".switcher")).toHaveLength(1);
});

const seed = () => mountSwitcher(null, [
  workstream("ws", { name: "new-onboarding" }),
  agent("a1", "idle", "idle", { parent: "ws", name: "renew-token" }),
], [info("7", { owner: "ws", title: "new-shell" })], () => null, { todos: [todo(1, "renew the token", "ws")], pads: [pad("new notes", "ws")] });

it("u5240b_searches_destinations_then_todos_and_pads_then_actions", async () => {
  await seed();
  direct();
  await waitOpen();
  await search(" new ");
  const values = options().map(row => row.dataset.value!);
  const items = values.findIndex(value => value.startsWith("todo:") || value.startsWith("pad:"));
  const actions = values.findIndex(value => value.startsWith("action:"));

  expect(values.slice(0, items).sort()).toEqual(["a1", "terminal:7", "ws"]);
  expect(values.slice(items, actions)).toEqual(["todo:1", "pad:i-new notes"]);
  expect(actions).toBeGreaterThan(items);
  await search("zzz-nothing");
  expect(options()).toEqual([]);
});

it("u5240b_enter_on_a_todo_or_pad_opens_it_as_a_click_does", async () => {
  const { connected } = await seed();

  for (const [query, kind] of [["renew the", "todo"], ["new notes", "pad"]] as const) {
    direct();
    await waitOpen();
    await search(query);
    await waitFor(() => expect(options().some(row => row.dataset.value?.startsWith(`${kind}:`))).toBe(true));
    const row = options().find(option => option.dataset.value?.startsWith(`${kind}:`))!;

    fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(row, { button: 0, pointerType: "mouse" });
    fireEvent.click(row);
    await waitFor(() => expect(field()).toBeNull());
    expect(connected.drawer.surface()).toEqual({ kind, project: "/p" });
    connected.drawer.close();
  }
});

const command = () => chord("agent.new");

const toCommand = async () => {
  await saveAppSettings({ quickAdd: "meta+shift+KeyY" });
  const mounted = await mountSwitcher("ops");

  mounted.app.handlers["agent.spawn"] = () => agent("created", "idle", "idle", { terminal_id: "created-terminal" });
  direct();
  await waitOpen();
  await search(command().what);
  await waitFor(() => expect(options().some(row => row.dataset.value?.startsWith("action:"))).toBe(true));

  return mounted;
};

it("u5240c_the_footer_lists_the_keys_of_the_highlighted_row", async () => {
  await mountSwitcher();
  direct();
  await waitOpen();
  await waitFor(() => expect(footer()).toEqual(["↑", "↓", "⏎", "Esc"]));
  expect(footer().join(" ")).not.toContain(SWITCHER_KEYS.record);
  expect(footer()).toContain(SWITCHER_KEYS.close);
  switcherKey("Enter", { metaKey: true }, field()!);
  expect(field()).not.toBeNull();
  await search(command().what);
  await waitFor(() => expect(footer()).toContain(SWITCHER_KEYS.record));
  await search("zzz-nothing");
  await waitFor(() => expect(footer()).not.toContain(SWITCHER_KEYS.record));
});

it("u5240d_cmd_enter_records_a_key_and_the_row_shows_it", async () => {
  await toCommand();
  const row = () => options().find(option => option.dataset.value?.startsWith("action:"))!;

  switcherKey("Enter", { metaKey: true }, field()!);
  await waitFor(() => expect(row().querySelector(".switcher-recording")).not.toBeNull());
  expect(field()).not.toBeNull();
  switcherKey("T", { metaKey: true, shiftKey: true }, field()!);
  await waitFor(() => expect(appSettings().shortcuts).toEqual({ "agent.new": "meta+shift+KeyT" }));
  await waitFor(() => expect(row().querySelector(".switcher-recording")).toBeNull());
  expect(row().textContent).toContain(chord("agent.new").keys);
  expect(field()).not.toBeNull();
  expect(chord("agent.new").presses).toEqual(["meta+shift+KeyT"]);
});

it("u5240d_a_refused_key_shows_its_cause_by_the_row_and_esc_cancels", async () => {
  await toCommand();
  switcherKey("Enter", { metaKey: true }, field()!);
  await waitFor(() => expect(recordingMark()).not.toBeNull());
  switcherKey("N", { metaKey: true, altKey: true }, field()!);
  await waitFor(() => expect(document.querySelector(".switcher-refusal")).not.toBeNull());
  expect(recordingMark()).not.toBeNull();
  switcherKey("Escape", {}, field()!);
  await waitFor(() => expect(recordingMark()).toBeNull());
  expect(field()).not.toBeNull();
  expect(appSettings().shortcuts).toEqual({});
});

it("u5240d_plain_enter_still_runs_the_command_once", async () => {
  const { app } = await toCommand();

  switcherKey("Enter", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1));
});

it("u5240e_record_mode_leaves_no_listener_behind", async () => {
  await toCommand();

  const { textarea, reached } = terminalField();

  const probe = () => {
    const press = new KeyboardEvent("keydown", { code: "KeyJ", key: "j", metaKey: true, bubbles: true, cancelable: true });

    textarea.dispatchEvent(press);

    return press.defaultPrevented;
  };

  field()!.focus();
  switcherKey("Enter", { metaKey: true }, field()!);
  await waitFor(() => expect(recordingMark()).not.toBeNull());
  switcherKey("Escape", {}, field()!);
  switcherKey("Escape", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  textarea.focus();
  expect(probe()).toBe(false);
  expect(reached).toEqual(["KeyJ"]);
  textarea.remove();
});
