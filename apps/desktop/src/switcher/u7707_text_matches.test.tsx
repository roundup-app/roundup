import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Found } from "@contracts/search/Found";
import type { SearchHit } from "@contracts/search/SearchHit";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";
import { RpcError } from "../app/seam";
import { agent, USER, workstream } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher, switcherKey } from "./switcherFixture";

afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear(); sessionStorage.clear(); });

const todo = (id: number, title: string): Todo => ({ id, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator: USER, home: null, owner: null, refs: [], priority: null });

const pad = (name: string): Pad => ({ incarnation: `i-${name}`, name, text: "", updated_at: 0, revision: 1, home: null, visibility: "shown" as const });

const hit = (kind: SearchHit["kind"], id: string, snippet = "a snippet", ranges: SearchHit["ranges"] = [], opens?: string): SearchHit => ({ kind, id, title: `${kind} ${id}`, snippet, ranges, ...(opens === undefined ? {} : { opens }) });

const TREE = [workstream("ws", { name: "renew" }), agent("a1", "idle", "idle", { parent: "ws", name: "renew-token" })];

const mount = (answer: (query: string) => Found | Promise<Found>, lists: Parameters<typeof mountSwitcher>[4] = { todos: [todo(1, "renew staging")], pads: [pad("new notes on renewal")] }) =>
  mountSwitcher(null, TREE, [], () => null, lists).then(mounted => {
    mounted.app.handlers["search.find"] = ({ query }) => answer(query);

    return mounted;
  });

const asked = (app: Awaited<ReturnType<typeof mount>>["app"]) => app.calls.filter(call => call.method === "search.find").map(call => (call.params as { query: string }).query);

const type = async (text: string) => {
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: text } });
  await waitFor(() => expect(field()!.value).toBe(text));
};

const values = (): string[] => [...document.querySelectorAll<HTMLElement>('.switcher [role="option"]')].map(row => row.dataset.value!);

const found = (...hits: SearchHit[]): Found => ({ hits, more: false });

it("u7707a_text_matches_follow_actions_and_repeat_no_title_row", async () => {
  const { app } = await mount(() => found(hit("message", "9", "renew the token before friday", [], "a1"), hit("pad", "new notes on renewal"), hit("todo", "1"), hit("todo", "2")));

  openSwitcher();
  await type(" renew ");
  await waitFor(() => expect(values().some(value => value.startsWith("found:"))).toBe(true));
  const all = values();
  const actions = all.findIndex(value => value.startsWith("action:"));
  const texts = all.findIndex(value => value.startsWith("found:"));

  expect(all.slice(0, actions === -1 ? texts : actions)).toEqual(expect.arrayContaining(["a1", "todo:1", "pad:i-new notes on renewal"]));
  expect(texts).toBeGreaterThan(Math.max(...all.map((value, at) => value.startsWith("action:") ? at : -1)));
  // A hit already shown by its title is not listed twice.
  expect(all.filter(value => value.startsWith("found:"))).toEqual(["found:message:9", "found:todo:2"]);
  const group = await within(document.querySelector(".switcher")!).findByRole("group", { name: "Text matches" });

  expect(within(group).getAllByRole("option")).toHaveLength(2);
  expect(asked(app)).toEqual(["renew"]);
});

it("u7707a_fewer_than_two_characters_makes_no_call", async () => {
  const { app } = await mount(() => found(hit("pad", "p")));

  openSwitcher();
  await type(" r ");
  await type("   ");
  expect(asked(app)).toEqual([]);
  expect(values().some(value => value.startsWith("found:"))).toBe(false);
  await type("re");
  await waitFor(() => expect(values()).toContain("found:pad:p"));
  expect(asked(app)).toEqual(["re"]);
  await type("");
  await waitFor(() => expect(values().some(value => value.startsWith("found:"))).toBe(false));
  expect(screen.queryByRole("group", { name: "Text matches" })).toBeNull();
});

it("u7707b_choosing_a_pad_a_todo_or_a_message_opens_it_once", async () => {
  const { app, connected } = await mount(() => found(hit("pad", "stored pad"), hit("todo", "5"), hit("message", "9", "x", [], "a1")), {});

  for (const [value, check] of [
    ["found:pad:stored pad", () => expect(connected.drawer.surface()).toEqual({ kind: "pad", project: "/p" })],
    ["found:todo:5", () => expect(connected.drawer.surface()).toEqual({ kind: "todo", project: "/p" })],
    ["found:message:9", () => expect(connected.rail.selected()).toBe("a1")],
  ] as const) {
    openSwitcher();
    await type("stored");
    await waitFor(() => expect(values()).toContain(value));
    fireEvent.click(document.querySelector(`[data-value="${value}"]`)!);
    await waitFor(() => expect(field()).toBeNull());
    check();
    connected.drawer.close();
  }

  expect(app.calls.some(call => call.method === "terminal.write")).toBe(false);
});

it("u7707b_a_message_whose_agent_is_gone_opens_nothing", async () => {
  const { connected } = await mount(() => found(hit("message", "9", "x", [], "gone-agent")), {});

  openSwitcher();
  await type("stored");
  await waitFor(() => expect(values()).toContain("found:message:9"));
  fireEvent.click(document.querySelector('[data-value="found:message:9"]')!);
  await screen.findByText("Its Agent is gone");
  expect(field()).not.toBeNull();
  expect(connected.rail.selected()).toBeNull();
});

it("u7707c_a_pending_reply_delays_no_key_and_an_old_reply_is_dropped", async () => {
  const pending = new Map<string, (found: Found) => void>();
  const { app, connected } = await mount(query => new Promise<Found>(resolve => pending.set(query, resolve)));

  openSwitcher();
  await type("ren");
  expect(values()).toContain("ws");
  switcherKey("Enter", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  expect(connected.rail.selected()).toBe("ws");
  openSwitcher();
  await type("rena");
  pending.get("rena")?.(found(hit("pad", "new")));
  await waitFor(() => expect(values()).toContain("found:pad:new"));
  // The reply for `ren` arrives last and is never shown.
  pending.get("ren")?.(found(hit("pad", "old")));
  await Promise.resolve();
  expect(values()).not.toContain("found:pad:old");
  expect(asked(app)).toEqual(["ren", "rena"]);
});

it("u7707c_searching_none_and_failed_states_show_with_retry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let reply: ((found: Found) => void) | null = null;
  let fail = true;
  const { app } = await mount(() => fail ? Promise.reject(new RpcError(-32603, "index is down")) : new Promise<Found>(resolve => { reply = resolve; }), {});

  openSwitcher();
  await type("zzzz");
  await vi.advanceTimersByTimeAsync(0);
  const dialog = within(screen.getByRole("dialog", { name: "Switch to" }));

  expect(document.querySelector(".switcher-searching")).toBeNull();
  fail = false;
  fireEvent.click(dialog.getByRole("button", { name: "Retry" }));
  expect(asked(app)).toEqual(["zzzz", "zzzz"]);
  // No reply yet: quiet until 150 ms have passed, and no no-match state while it is out.
  expect(document.querySelector(".switcher-searching")).toBeNull();
  expect(dialog.queryByText(/“zzzz”/)).toBeNull();
  await vi.advanceTimersByTimeAsync(150);
  expect(document.querySelector(".switcher-searching")).not.toBeNull();
  reply!(found());
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector(".switcher-searching")).toBeNull();
  // U51's empty state: with an open Project it offers the name instead of saying `No match`.
  expect(dialog.getByText(/“zzzz”/)).toBeDefined();
});

it("u7707d_ranges_mark_exactly_the_matched_characters", async () => {
  await mount(() => found(hit("message", "9", "renew 🧭 the token", [{ start: 0, end: 5 }, { start: 9, end: 12 }], "a1")), {});

  openSwitcher();
  await type("renew");
  await waitFor(() => expect(values()).toContain("found:message:9"));
  const row = document.querySelector<HTMLElement>('[data-value="found:message:9"]')!;

  expect([...row.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(["renew", "the"]);
  expect(row.querySelector(".switcher-snippet")!.textContent).toBe("renew 🧭 the token");
});

it("u7707d_a_capped_reply_shows_the_narrowing_line", async () => {
  const many = Array.from({ length: 25 }, (_, n) => hit("pad", `p${n}`));
  const { app } = await mount(() => ({ hits: many, more: true }), {});

  openSwitcher();
  await type("many");
  await waitFor(() => expect(values().filter(value => value.startsWith("found:"))).toHaveLength(20));
  expect(screen.getByText("More matches: add words to narrow").closest("[role=option]")).toBeNull();
  expect(asked(app)).toEqual(["many"]);
});
