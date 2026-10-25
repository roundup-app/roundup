import { useBrowserStorage } from "../state/storage";
import { questionProbe } from "./menuProbe";
import { createEffect, createRoot } from "solid-js";
import { render } from "solid-js/web";
import { mountTodoWorstCase } from "./todoWorstCase";
import { captureActions } from "../keys/registry";
import { App } from "../App";
import { createXtermEmulators } from "../terminal/emulator";
import type { Emulator } from "../terminal/emulator";
import { railStorage } from "../rail/persist/storage";
import { createReducedMotion } from "../app/reducedMotion";
import { runAxe } from "./axe";
import type { AxeResult } from "./axe";
import { runChecks } from "./checks";
import type { Checks } from "./checks";
import { createServedApp } from "./realSeam";
import { isSeedName, SEEDS, seedApp } from "./seeds";
import type { Controls } from "./seeds";
import type { AppSeam } from "../app/seam";
import "../tokens.css";
import "../styles.css";
import "../scrollbar.css";
import { trackScrollbars } from "../scrollHover";
import "./todoWorstCase.styles.css";

declare global {
  interface Window {
    __fake: Controls;
    __question: typeof questionProbe;
    __terminals: Map<string, Emulator>;
    /** U463: cancel only the next isolated choice; no caller-supplied path. */
    __firstRun?: { cancelNextChoice: () => void };
    __checks: () => Checks;
    __axe: () => Promise<AxeResult>;
  }
}

useBrowserStorage(window.localStorage);

window.__question = questionProbe;

trackScrollbars(document);

const root = document.getElementById("root");

if (!root) throw new Error("harness.html has no #root element");

const query = new URLSearchParams(location.search);

const mount = (app: AppSeam) => {
  const reducedMotion = createRoot(() => createReducedMotion((media) => window.matchMedia(media)));

  const createEmulator = query.get("renderer") === "dom"
    ? createXtermEmulators(undefined, () => { throw new Error("DOM renderer requested by observer"); })
    : createXtermEmulators();

  window.__terminals = new Map();
  const requested = new Set<string>();

  const inspection = (open: import("../state/connectedProject").ConnectedProject) => {
    createEffect(() => {
      if (query.get("tabs") === "1") open.showView("terminal-tabs");
    });
  };

  render(() => <App app={app} reducedMotion={reducedMotion} clock={Date.now} prepareIdle={open => {
    if (requested.has(open.project.path)) return;
    requested.add(open.project.path);
    inspection(open);

    if (query.get("view") === "workstreams") open.showView("workstreams");

    if (query.get("items") === "1") queueMicrotask(() => {
      if (document.querySelector('.window[data-shelf="closed"]')) captureActions(document.activeElement).find(action => action.value === "action:leader:S")?.run();
    });
  }} createEmulator={(id) => {
    const emulator = createEmulator(id);
    window.__terminals.set(id, emulator);

    return emulator;
  }} />, root);
};

window.__checks = () => runChecks();

window.__axe = () => runAxe();

if (query.get("daemon") === "1") {
  // `just harness-real` (U144): the same App on a running `rupd`, so there is no `window.__fake`.
  if (query.get("seed") === "first-run") {
    let cancel = false;

    window.__firstRun = { cancelNextChoice: () => { cancel = true; } };
    mount(createServedApp(location.origin, () => {
      const result = cancel ? "cancel" : "choose";

      cancel = false;

      return result;
    }));
  } else mount(createServedApp(location.origin));
} else {
  const seed = query.get("seed") ?? "tree-40";

  if (!isSeedName(seed)) throw new Error(`unknown seed "${seed}"; one of ${SEEDS.join(", ")}`);

  const controls = seedApp(seed, Date.now());

  if (query.get("import") === "dense") {
    controls.app.handlers["project.importDiscover"] = () => ({
      candidates: Array.from({ length: 10 }, (_, index) => ({
        source: `conversation-${index}`, revision: `revision-${index}`,
        title: `調査と実装 — résumé — ${"Long conversation title ".repeat(8)}${index}`,
        cwd: `packages/${"deep-folder/".repeat(10)}destination-${index}`,
        last_activity_ms: 1_792_512_000_000n - BigInt(index * 60_000),
      })),
      excluded: [{ source: "unavailable-conversation", cause: "missingDirectory", reason: "Source unavailable: folder no longer exists.", title: null, last_activity_ms: 1700000000000n }],
    });
    controls.app.handlers["project.importCommit"] = ({ selections }) => ({
      outcomes: selections.map(({ source }, index) => index === 0
        ? { source, workstream: "backend", agent: "migrate", error: null }
        : { source, workstream: null, agent: null, error: { code: -32003, message: "Source changed. Refresh and retry.", outcome: "failed" } }),
    });
  }

  const SELECTED = new Map([["door-stopped", "first-workstream"], ["door-report", "r1"], ["earlier-run", "earlier-agent"], ["context-bar", "split-agent"]]);

  const selected = SELECTED.get(seed);

  if (selected) {
    const failure = await railStorage(controls.app.opened.project!.path).write({ selected, collapsed: [] });

    if (failure !== null) throw new Error(failure);
  }

  window.__fake = controls;
  mount(controls.app);

  if (query.get("todos") === "worst") mountTodoWorstCase(controls);
}
