import { render, screen, waitFor } from "@solidjs/testing-library";
import type { RailNode } from "@contracts/agent/RailNode";
import { expect } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import type { FakeApp } from "../testing/fakeApp";

export const path = (name: string): string => `/Users/me/${name}`;

/** The App on a fake whose open Projects are `names`, each with its own Rail tree. */
export const openTabs = async (trees: Record<string, RailNode[]>) => {
  window.localStorage.clear();

  const app = createFakeApp();
  const names = Object.keys(trees);

  for (const name of names) app.add(path(name));

  for (const name of names) {
    const daemon = app.of(path(name));

    daemon.handlers["rail.tree"] = () => trees[name] ?? [];
    daemon.handlers["terminal.list"] = () => [];
  }

  const view = render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(names.length));
  await settled(app, names);

  return { app, view };
};

/** Every Project's first `rail.tree` has been fetched, so its Tab mark is current. */
const settled = async (app: FakeApp, names: string[]) => {
  await waitFor(() => {
    for (const name of names) expect(app.of(path(name)).calls.some((call) => call.method === "rail.tree")).toBe(true);
  });
  await new Promise((done) => setTimeout(done, 0));
};

export const tab = (name: string): HTMLElement => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

export const header = (): HTMLElement => screen.getByRole("banner");

export const rowSelected = (id: string): string | null => document.querySelector(`[role=treeitem][data-id="${id}"]`)?.getAttribute("aria-selected") ?? null;

export const treeOf = (app: FakeApp, name: string, nodes: RailNode[]) => {
  app.of(path(name)).handlers["rail.tree"] = () => nodes;
};

/** The Daemon of one Project says its Rail changed, after `treeOf` swapped what it answers. */
export const changed = async (app: FakeApp, name: string) => {
  const { event } = await import("../testing/nodes");

  app.of(path(name)).emit(event({ name: "rail.changed" }));
};
