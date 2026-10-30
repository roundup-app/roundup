// @vitest-environment jsdom
import { openSwitcher, field, switcherKey as press } from "../switcher/switcherFixture";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

it("u2773a_queries_keep_original_project_through_switch_events_and_reopen", async () => {
  const first = await startRealDaemon({});
  const second = await startRealDaemon({});

  try {
    const served = [createServedApp(first.base), createServedApp(second.base)];
    const projects = [(await served[0]!.projects())[0]!, (await served[1]!.projects())[0]!];

    const identities = await Promise.all(served.map((app) => app.rpc("rail.createWorkstream", { name: "same name", parent: null })));
    const mutations: string[] = [];

    const apps = served.map((app): AppSeam => ({ ...app, rpc: (method, params) => {
      if (!["rail.tree", "terminal.list", "daemon.ping", "worktree.status", "events.subscribe", "terminal.scheme", "todo.unread"].includes(method)) mutations.push(method);

      return app.rpc(method, params);
    } }));

    const app: AppSeam = { ...apps[0]!, projects: async () => projects, forProject: (path) => apps[path === first.dir ? 0 : 1]! };
    const mount = () => render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const chooseProject = async (path: string) => {
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"]`)).not.toBeNull());
      fireEvent.click(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)!);
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)?.getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${identities[path === first.dir ? 0 : 1]!.id}"]`)).not.toBeNull());
    };

    mount();
    await chooseProject(first.dir);
    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    fireEvent.input(field()!, { target: { value: "  first e\u0301 🧭 東京  " } });
    field()!.setSelectionRange(2, 8, "backward");
    press("Escape", {}, field()!);
    await chooseProject(second.dir);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(""));
    fireEvent.input(field()!, { target: { value: " second 🧭 " } });
    press("Escape", {}, field()!);
    await served[0]!.rpc("rail.rename", { id: identities[0]!.id, name: "incoming rename" });
    await chooseProject(first.dir);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe("  first e\u0301 🧭 東京  "));
    await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 8, "backward"]));
    press("Escape", {}, field()!);
    mutations.length = 0;
    cleanup();
    mount();
    await chooseProject(second.dir);
    expect(field()).toBeNull();
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(" second 🧭 "));
    expect(mutations.filter((method) => !method.endsWith(".list") && !method.endsWith(".get") && !method.endsWith(".count") && method !== "workstream.queue" && method !== "todo.listHanded")).toEqual([]);
  } finally {
    cleanup();
    await second.stop();
    await first.stop();
  }
}, 60_000);
