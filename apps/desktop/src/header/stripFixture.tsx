import { render, screen, waitFor, within } from "@solidjs/testing-library";
import type { RailNode } from "@contracts/agent/RailNode";
import { expect } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import type { FakeApp } from "../testing/fakeApp";

export const path = (name: string): string => `/Users/me/${name}`;

/** The App on a fake whose open Projects are `names`, each with its own Rail tree; it returns before any Project connects. */
export const renderTabs = (trees: Record<string, RailNode[]>, keepStorage = false) => {
  if (!keepStorage) window.localStorage.clear();

  const app = createFakeApp();
  const names = Object.keys(trees);

  for (const name of names) app.add(path(name));

  for (const name of names) {
    const daemon = app.of(path(name));

    daemon.handlers["rail.tree"] = () => trees[name] ?? [];
    daemon.handlers["terminal.list"] = () => [];
  }

  const view = render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);

  return { app, view };
};

/** `renderTabs`, once no tab is busy, so every Project's Rail and Tab mark is current (U181). */
export const openTabs = async (trees: Record<string, RailNode[]>, keepStorage = false) => {
  const opened = renderTabs(trees, keepStorage);

  await waitFor(() => expect(projectTabs().map((tab) => tab.getAttribute("aria-busy"))).toEqual(Object.keys(trees).map(() => "false")));

  return opened;
};

export const tab = (name: string): HTMLElement => within(projectTablist()).getByRole("tab", { name: new RegExp(`^${name}`) });

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

/** The Project tabs (U179), not the Shelf's (U373). */
export const projectTablist = (): HTMLElement => screen.getByRole("tablist", { name: "Projects" });

export const projectTabs = (): HTMLElement[] => within(projectTablist()).queryAllByRole("tab");
