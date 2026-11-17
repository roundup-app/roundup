import { isDoor } from "../state/doorNode";
import { copy } from "./copy";
import { render, waitFor } from "@solidjs/testing-library";
import { expect } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import type { SeedName } from "../testing/seeds";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { createProjectDrafts } from "../state/connectedProject";

export const open = async (seed: SeedName = "tree-40", rows: readonly string[] = ["backend", "auth", "payments", "migrate", "tokens", "logins", "docs", "agent-1", "agent-4"], withWorktree = false, tab: "Todos" | "Pads" = copy.todos, clock = () => 0, prepare?: (controls: ReturnType<typeof seedApp>) => Promise<void>) => {
  const controls = seedApp(seed, 0);

  if (seed === "tree-40") {
    const tree = await controls.app.rpc("rail.tree", null);

    if (withWorktree) for (const node of tree) if (isDoor(node)) node.worktree = {path: `/Users/you/harness/.roundup/worktrees/${node.id}`, branch: node.id, base: "main"};
    controls.app.handlers["rail.tree"] = () => tree.filter(node => rows.includes(node.id));
  }

  await prepare?.(controls);
  const drafts = createProjectDrafts();
  const emulators = fakeEmulators();
  const view = render(() => <App app={controls.app} drafts={drafts} reducedMotion={() => true} clock={clock} createEmulator={emulators.factory} />);
  await showEverythingInApp(undefined, tab);

  return { ...controls, view, drafts, emulators };
};

export const cases = ["todo-shelf", "pad-shelf", "workstream", "agent"] as const;

type RowCase = typeof cases[number];

export const target = async (kind: RowCase, rows: readonly string[] = ["backend", "auth", "tokens", "payments", "agent-4"]) => {
  const controls = await open("tree-40", rows, false, kind === "pad-shelf" ? copy.pads : copy.todos);

  const selector = {
    "todo-shelf": '.todos-tab [data-todo="1"] .todo-row-button',
    "pad-shelf": '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"] .pad-name',
    workstream: '.rail-row[data-id="payments"]',
    agent: '.rail-row[data-id="tokens"]',
  }[kind];

  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());

  return { ...controls, row: document.querySelector<HTMLElement>(selector)! };
};
