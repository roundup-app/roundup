// @vitest-environment jsdom
import { openSwitcher, field, switcherKey as press } from "../switcher/switcherFixture";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { workstream } from "./nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

it("u2773a_queries_keep_original_project_through_switch_events_and_reopen", async () => {
  const app = createFakeApp();
  const projects = [app.add("/first", "same Project"), app.add("/second", "same Project")];
  const apps = projects.map(project => app.of(project.path));
  const identities = projects.map(() => workstream("same-id", { name: "same name" }));

  apps.forEach((connection, index) => { connection.handlers["rail.tree"] = () => [identities[index]!]; });
  const [first, second] = projects;

  try {
    const mount = () => render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const chooseProject = async (path: string) => {
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"]`)).not.toBeNull());
      fireEvent.click(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)!);
      await waitFor(() => expect(document.querySelector(`.project-tab[data-path="${path}"] [role="tab"]`)?.getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${identities[path === first!.path ? 0 : 1]!.id}"]`)).not.toBeNull());
    };

    mount();
    await chooseProject(first!.path);
    openSwitcher();
    await waitFor(() => expect(field()).not.toBeNull());
    fireEvent.input(field()!, { target: { value: "  first e\u0301 🧭 東京  " } });
    field()!.setSelectionRange(2, 8, "backward");
    press("Escape", {}, field()!);
    await chooseProject(second!.path);
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(""));
    fireEvent.input(field()!, { target: { value: " second 🧭 " } });
    press("Escape", {}, field()!);
    identities[0] = { ...identities[0]!, name: "incoming rename" };
    apps[0]!.emit({ name: "rail.changed", actor: { kind: "user", id: "user", parent: null } });
    await chooseProject(first!.path);
    await waitFor(() => expect(document.querySelector('.rail-row[data-id="same-id"] .name')?.textContent).toBe(identities[0]!.name));
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe("  first e\u0301 🧭 東京  "));
    await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 8, "backward"]));
    press("Escape", {}, field()!);
    cleanup();
    mount();
    await chooseProject(second!.path);
    expect(field()).toBeNull();
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(" second 🧭 "));
    const reads = new Set(["rail.tree", "terminal.list", "daemon.ping", "daemon.methods", "worktree.status", "terminal.scheme", "todo.unread", "workstream.queue", "daemon.getNaming", "models.list", "todo.listHanded"]);
    expect(apps.flatMap(connection => connection.calls).filter(({ method }) => !reads.has(method) && !method.endsWith(".list") && !method.endsWith(".get") && !method.endsWith(".count"))).toEqual([]);
  } finally {
    cleanup();
  }
}, 60_000);
