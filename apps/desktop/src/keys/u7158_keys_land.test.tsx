import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApp, rpcCalls } from "../testing/appFixture";
import { agent, info, USER, workstream } from "../testing/nodes";
import { showShelfTab } from "../testing/shelfTabs";
import { padHandlers, todoHandlers } from "../testing/stores";
import { endLeader, leaderArmed } from "./registry";
import { leaderKey } from "./leaderFixture";

afterEach(() => { endLeader(); document.querySelectorAll("[data-fixture]").forEach(each => each.remove()); });

/** alpha works (a live Terminal), beta waits for the user, harbor has no Door. */
const mount = () => mountApp(app => {
  app.handlers["rail.tree"] = () => [
    agent("a", "working", "editing", { name: "alpha", order: 0 }),
    agent("b", "needs-you", "asks", { name: "beta", order: 1 }),
    workstream("w", { name: "harbor", order: 2 }),
  ];
  app.handlers["terminal.list"] = () => [info("t-a"), info("t-b")];
  Object.assign(
    app.handlers,
    todoHandlers({ todos: [{ id: 1, title: "todo one", body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator: USER, home: null, owner: { kind: "agent", id: "a", parent: null }, refs: [], priority: null }] }, () => {}),
    padHandlers({ pads: [{ incarnation: "notes-1", name: "notes", text: "", updated_at: 0, revision: 1, home: "home" }], history: [] }, () => {}),
  );
});

const row = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`);

  if (!found) throw new Error(`no Rail row for ${id}`);

  return found;
};

/** Where the keyboard is: the Terminal's id, or the focused element's tag and class. */
const at = (): string => {
  const focus = document.activeElement;

  return focus?.closest("[data-terminal]")?.getAttribute("data-terminal") ?? `${focus?.tagName.toLowerCase()}.${focus?.className}`;
};

const inCentre = () => at().startsWith("t-");

/** Where each typed character's `keypress` was delivered: the browser sends it to the element focus holds once `keydown` has run. */
const typed = async (keys: string): Promise<string[]> => {
  const reached: string[] = [];

  const watch = (event: Event) => {
    const target = event.target instanceof Element ? event.target : document.body;

    reached.push(target.closest("[data-terminal]")?.getAttribute("data-terminal") ?? target.tagName.toLowerCase());
  };

  // listener-owner: removed again before this helper returns.
  document.addEventListener("keypress", watch, true);
  await userEvent.keyboard(keys);
  document.removeEventListener("keypress", watch, true);

  return reached;
};

const choose = async (id: string, terminal: string) => {
  fireEvent.click(row(id));
  await waitFor(() => expect(at()).toBe(terminal));
};

const listRow = async (selector: string): Promise<HTMLElement> => waitFor(() => {
  const found = document.querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`no row for ${selector}`);

  return found;
});

describe("u7158 keys land where you think you're typing", () => {
  const ways: [string, () => Promise<void> | void][] = [
    ["a click on a Rail row", () => { fireEvent.click(row("a")); }],
    ["a click on the selected Rail row after focus moved", async () => { await choose("a", "t-a"); row("b").focus(); fireEvent.click(row("a")); }],
    ["Enter on a focused Rail row", async () => { row("a").focus(); await userEvent.keyboard("{Enter}"); }],
    ["the Switcher closing on a row", async () => { leaderKey("KeyK"); await userEvent.keyboard("alpha{Enter}"); }],
    ["the Switcher closing on Escape", async () => { await choose("a", "t-a"); leaderKey("KeyK"); await screen.findByRole("dialog"); await userEvent.keyboard("{Escape}"); }],
    ["closing a Todo drawer", async () => {
      await choose("a", "t-a");
      showShelfTab("Todos");
      (await listRow('[data-todo="1"] .todo-row-button')).focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull());
      await userEvent.keyboard("{Escape}");
    }],
    ["closing a Pad drawer", async () => {
      await choose("a", "t-a");
      showShelfTab("Pads");
      fireEvent.dblClick(await listRow(".pad-name"));
      await waitFor(() => expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull());
      await userEvent.keyboard("{Escape}");
    }],
    ["closing Settings", async () => {
      await choose("a", "t-a");
      fireEvent.keyDown(document.activeElement ?? document.body, { key: ",", code: "Comma", metaKey: true });
      await screen.findByRole("heading", { name: /Settings/ });
      await userEvent.keyboard("{Escape}");
    }],
  ];

  it.each(ways)("u7158a_every_navigation_action_puts_the_keyboard_in_the_centre: %s", async (_name, way) => {
    const { app } = await mount();

    row("b").focus();
    await way();
    await waitFor(() => expect(at()).toBe("t-a"));

    expect(await typed("x")).toEqual(["t-a"]);
    expect(rpcCalls(app, "terminal.write")).toEqual([]);
  });
});

describe("u7158 a stray key goes to the centre", () => {
  const places: [string, () => void][] = [
    ["a Rail row", () => row("b").focus()],
    ["a Project tab", () => document.querySelector<HTMLElement>(".project-tab button")?.focus()],
    ["a button", () => { row("b").querySelector("button")?.focus(); }],
    ["the page body", () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }],
  ];

  it.each(places)("u7158b_a_character_pressed_on_something_that_takes_no_text_goes_to_the_centre: %s", async (_name, place) => {
    const { app } = await mount();

    await choose("a", "t-a");
    place();

    expect(await typed("x")).toEqual(["t-a"]);
    expect(at()).toBe("t-a");
    expect(rpcCalls(app, "terminal.write")).toEqual([]);
  });

  it("u7158c_keys_that_mean_something_keep_their_meaning", async () => {
    await mount();
    await choose("a", "t-a");

    row("a").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("b"));

    for (const key of ["Escape", "Tab"]) expect(fireEvent.keyDown(row("b"), { key, code: key })).toBe(true);

    expect(document.activeElement).toBe(row("b"));

    fireEvent.keyDown(row("b"), { key: "k", code: "KeyK", metaKey: true });
    expect([leaderArmed(), inCentre()]).toEqual([true, false]);
    endLeader();

    const pressed = vi.fn();
    const button = document.body.appendChild(document.createElement("button"));

    button.dataset.fixture = "";
    // listener-owner: the button is removed by afterEach with the other fixtures.
    button.addEventListener("click", pressed);
    button.focus();
    await userEvent.keyboard(" ");
    expect([pressed.mock.calls.length, document.activeElement]).toEqual([1, button]);

    row("b").focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(row("b").getAttribute("data-selected")).toBe("true"));
  });

  it("u7158c_keys_pressed_with_a_command_modifier_stay_where_they_are", async () => {
    await mount();
    await choose("a", "t-a");
    row("b").focus();

    for (const init of ["{Meta>}x{/Meta}", "{Control>}x{/Control}", "{Alt>}x{/Alt}"]) {
      await userEvent.keyboard(init);
      expect(at()).not.toBe("t-a");
    }
  });

  it.each(["input", "textarea", "div"])("u7158d_a_text_owner_keeps_every_key: %s", async (tag) => {
    await mount();
    await choose("a", "t-a");

    const owner = document.body.appendChild(document.createElement(tag));

    owner.dataset.fixture = "";

    if (tag === "div") owner.setAttribute("contenteditable", "true");
    owner.setAttribute("tabindex", "0");
    owner.focus();
    await userEvent.keyboard("x");

    expect(document.activeElement).toBe(owner);
  });

  it("u7158e_with_no_running_terminal_a_stray_key_does_nothing", async () => {
    const { app } = await mount();

    fireEvent.click(row("w"));
    await waitFor(() => expect(row("w").getAttribute("data-selected")).toBe("true"));
    row("b").focus();

    // "a" would find the row "alpha" were a letter still type-to-find.
    expect((await typed("a")).filter(each => each.startsWith("t-"))).toEqual([]);
    expect(document.activeElement).toBe(row("b"));
    expect(rpcCalls(app, "terminal.write")).toEqual([]);
  });

  it("u7158f_an_agent_that_needs_you_gets_the_focus_and_not_the_key", async () => {
    const { app } = await mount();

    await choose("b", "t-b");
    row("a").focus();

    expect(await typed("x")).toEqual([]);
    expect(at()).toBe("t-b");
    expect(rpcCalls(app, "terminal.write")).toEqual([]);
  });

  it("u7158f_a_key_typed_inside_the_waiting_terminal_is_left_alone", async () => {
    await mount();
    await choose("b", "t-b");

    const inside = document.createElement("div");
    const seen = vi.fn();

    await waitFor(() => expect(document.querySelector(".pane-screen")).not.toBeNull());
    document.querySelector(".pane-screen")?.appendChild(inside);

    inside.dataset.fixture = "";
    inside.tabIndex = 0;
    // listener-owner: the fixture element is removed by afterEach.
    inside.addEventListener("keydown", seen);
    inside.focus();

    expect([fireEvent.keyDown(inside, { key: "x" }), seen.mock.calls.length]).toEqual([true, 1]);
  });

  it("u7158g_a_composed_key_and_a_dead_key_arrive_whole", async () => {
    await mount();
    await choose("a", "t-a");
    row("b").focus();

    const composed = new KeyboardEvent("keydown", { key: "あ", isComposing: true, bubbles: true, cancelable: true });

    row("b").dispatchEvent(composed);
    expect([inCentre(), composed.defaultPrevented]).toEqual([false, false]);

    const dead = new KeyboardEvent("keydown", { key: "Dead", code: "Quote", bubbles: true, cancelable: true });

    row("b").dispatchEvent(dead);
    expect([inCentre(), dead.defaultPrevented]).toEqual([true, false]);
  });
});
