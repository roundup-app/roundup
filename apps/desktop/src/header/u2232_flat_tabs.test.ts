import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountBubbles } from "../bubbles/bubblesFixture";
import { info } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([
  ["project", true], ["project", false],
  ["terminal", true], ["terminal", false],
] as const)("u2234_a_rename_field_opens_without_selecting_the_tab_%s_%s", async (surface, selected) => {
  if (surface === "project") {
    await openTabs({ api: [], web: [] });
    fireEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
    const active = tab("api");
    const target = selected ? active : tab("web");
    const activeTab = active.closest(".project-tab")!;
    const targetTab = target.closest(".project-tab")!;

    if (selected) fireEvent.dblClick(target.querySelector(".tab-name")!);
    else {
      target.focus();
      fireEvent.keyDown(target, { key: "F2" });
    }

    const field = await screen.findByRole("textbox", { name: "Project name" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(targetTab.getAttribute("data-selected")).toBe(String(selected));
    expect(activeTab.getAttribute("data-selected")).toBe("true");
  } else {
    await mountBubbles();
    const target = document.querySelector<HTMLButtonElement>(`.terminal-tab[data-bubble="${selected ? "2" : "1"}"]`)!;
    expect(target.getAttribute("aria-pressed")).toBe(String(selected));
    fireEvent.dblClick(target);
    const field = document.querySelector(".terminal-tab-editor input");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field).not.toBeNull();
    expect(document.querySelector(`.terminal-tab-pair[data-bubble="${selected ? "2" : "1"}"]`)?.getAttribute("data-selected")).toBe(String(selected));
  }
});

it("u2235_flat_tabs_scroll_inside_the_pane_and_stay_reachable", async () => {
  const names = Array.from({ length: 8 }, (_, index) => `Run ${index} · full authored name 雪 🧭`);
  await mountBubbles("a", names.map((title, index) => info(String(index), { owner: "a", title })));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".terminal-tab")];
  expect(tabs).toHaveLength(names.length);

  for (const [index, target] of tabs.entries()) {
    target.focus();
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute("aria-label")).toBe(names[index]);
  }
});
