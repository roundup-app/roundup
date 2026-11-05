import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountApp, select } from "../testing/appFixture";
import { mountNavigation } from "../testing/navigationFixture";

const railRow = () => document.querySelector<HTMLElement>('.rail-row[data-selected="true"]')!;

/** Every floating surface the App can open from a selected Agent: how to open it, and what shows it open. A new floating surface adds its row here. */
const surfaces: {
  name: string;
  /** Where focus is before the surface opens; the Agent's Terminal when absent. */
  from?: () => HTMLElement;
  /** The Agent to select and the App to open it in; a second Project is needed for the Project picker. */
  twoProjects?: true;
  open: () => void;
  shown: () => Element | null;
}[] = [
  {
    name: "Ask bar",
    open: () => key("/", { metaKey: true }),
    shown: () => document.querySelector('.ask-bar[data-mode="over"]'),
  },
  {
    name: "Switcher",
    open: () => key("P", { metaKey: true, shiftKey: true }),
    shown: () => screen.queryByRole("dialog", { name: /switch/i }),
  },
  {
    name: "Help",
    from: railRow, open: () => key("?", { shiftKey: true, code: "Slash" }),
    shown: () => document.querySelector(".help"),
  },
  {
    name: "Feedback",
    open: () => key("F", { metaKey: true, shiftKey: true }),
    shown: () => document.querySelector(".feedback-form"),
  },
  {
    name: "Create menu",
    from: () => screen.getByRole("button", { name: "Create" }),
    open: () => { const button = screen.getByRole("button", { name: "Create" }); fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" }); fireEvent.click(button); },
    shown: () => document.querySelector(".rail-create-menu"),
  },
  {
    name: "Capture",
    open: () => key("T", { metaKey: true, shiftKey: true }),
    shown: () => screen.queryByRole("dialog", { name: /capture/i }),
  },
  {
    name: "Move picker",
    from: railRow,
    open: () => key("M", { code: "KeyM" }),
    shown: () => document.querySelector(".choice-picker"),
  },
  {
    name: "Terminal Find",
    open: () => key("F", { metaKey: true }),
    shown: () => document.querySelector(".terminal-find"),
  },
  {
    name: "New Agent prompt",
    open: () => key("N", { metaKey: true, shiftKey: true }),
    shown: () => document.querySelector(".spawn-prompt-field"),
  },
  {
    name: "Project picker",
    twoProjects: true,
    open: () => { key("K", { metaKey: true }); key("P", { code: "KeyP" }); },
    shown: () => screen.queryByRole("combobox", { name: /project/i }),
  },
];

const key = (name: string, init: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", {
      key: name,
      code:
        name.length === 1 && /[a-z]/i.test(name)
          ? `Key${name.toUpperCase()}`
          : name === "/"
            ? "Slash"
            : name,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );

/** Escapes still bubbling at the window after every layer has run: the ones the Terminal would see. */
const reached: Event[] = [];

const watch = (event: Event) => {
  if (event instanceof KeyboardEvent && event.key === "Escape") reached.push(event);
};

afterEach(() => {
  window.removeEventListener("keydown", watch);
  reached.length = 0;
});

const terminalFocus = async (twoProjects = false) => {
  if (twoProjects) await mountNavigation();
  else await mountApp();

  select(twoProjects ? "Agent 1" : "alpha");
  await waitFor(() =>
    expect(document.querySelector(".pane-screen")).not.toBeNull(),
  );

  const opener = document.querySelector<HTMLElement>(
    ".pane-screen textarea, .pane-screen",
  );

  opener?.focus();
  window.addEventListener("keydown", watch);

  if (!(document.activeElement instanceof HTMLElement)) throw new Error("the Terminal took no focus");

  return { opener: document.activeElement };
};

describe("u6175 Esc and floating surfaces", () => {
  it.each(surfaces)(
    "u6175a_escape_closes_each_floating_surface: $name",
    async ({ from, open, shown, twoProjects }) => {
      const { opener } = await terminalFocus(twoProjects);
      const origin = from?.() ?? opener;

      origin.focus();

      open();
      await waitFor(() => expect(shown()).not.toBeNull());
      await waitFor(() => expect(shown()?.contains(document.activeElement)).toBe(true));
      // Ark's dismissable layer registers a tick after the surface mounts.
      await new Promise((done) => setTimeout(done, 50));
      reached.length = 0;

      const escape = key("Escape");

      await waitFor(() => expect(shown()).toBeNull());
      expect(escape).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(origin));
      // The library's focus trap deactivates a tick after its surface closes.
      await new Promise((done) => setTimeout(done, 50));
    },
  );

  it("u6175b_escape_reaches_the_terminal_when_nothing_floats", async () => {
    await terminalFocus();
    expect(key("Escape")).toBe(true);
    expect(reached).toHaveLength(1);
  });
});
