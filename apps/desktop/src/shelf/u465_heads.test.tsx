import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Tabs } from "../ui/Tabs";
import { createShelfFrame } from "./frame";
import { createShelfTabs, ProjectShelfTabs, Shelf } from "./Shelf";
import { seedApp } from "../testing/seeds";

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = async () => {
  window.matchMedia ??= (media) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  const connected = await connectProject(seedApp("tree-40", 0).app, { name: "harness", path: "/Users/you/harness" }, () => true, () => 0);

  await connected.rail.settled();
  render(() => {
    const frame = createShelfFrame(() => connected.project.path, () => true, undefined);
    const tabs = createShelfTabs(frame);

    return <ConnectedProjectContext.Provider value={connected}>
      <Tabs.RootProvider value={tabs}>
        <ProjectShelfTabs frame={frame} onToggle={frame.toggle} />
      </Tabs.RootProvider>
      <div class="shelf">
        <Tabs.RootProvider value={tabs} id="shelf-panels" lazyMount unmountOnExit>
          <Shelf open={frame.open} />
        </Tabs.RootProvider>
      </div>
    </ConnectedProjectContext.Provider>;
  });

  return within(await screen.findByRole("tablist", { name: "Work items" })).getAllByRole("tab");
};

// Left/Right and Home/End selection runs on real key events in u491a_browser.test.ts; Ark's selection follows focus on requestAnimationFrame, which jsdom does not order like a browser.
it("u465_heads_keep_tab_roles_and_panel_links", async () => {
  const tabs = await mount();

  expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1]);

  for (const selected of [0, 1] as const) {
    tabs[selected]!.focus();

    if (tabs[selected]!.getAttribute("aria-expanded") !== "true") fireEvent.click(tabs[selected]!);
    await waitFor(() => expect(tabs[selected]!.getAttribute("aria-selected")).toBe("true"));

    const panel = await waitFor(() => {
      const panels = [...document.querySelectorAll('.shelf [role="tabpanel"]')];

      expect(panels.map(own => own.getAttribute("aria-labelledby"))).toEqual([tabs[selected]!.id]);

      return panels[0]!;
    });

    expect(tabs[selected]!.getAttribute("aria-controls")).toBe(panel.id);
    expect(tabs.map(tab => tab.tabIndex)).toEqual(selected === 0 ? [0, -1] : [-1, 0]);
    await waitFor(() => expect(panel.querySelector(`section[aria-label="${selected === 0 ? "Todos" : "Pads"}"]`)).not.toBeNull());
    expect(tabs[selected]!.querySelectorAll("button, [tabindex]")).toHaveLength(0);
  }
});
