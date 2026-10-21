import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { mountTodoWorstCase } from "./todoWorstCase";
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
import "./todoWorstCase.styles.css";

declare global {
  interface Window {
    __fake: Controls;
    __terminals: Map<string, Emulator>;
    /** U463: cancel only the next isolated choice; no caller-supplied path. */
    __firstRun?: { cancelNextChoice: () => void };
    __checks: () => Checks;
    __axe: () => Promise<AxeResult>;
  }
}

const root = document.getElementById("root");

if (!root) throw new Error("harness.html has no #root element");

const query = new URLSearchParams(location.search);

const mount = (app: AppSeam) => {
  const reducedMotion = createRoot(() => createReducedMotion((media) => window.matchMedia(media)));

  const createEmulator = query.get("renderer") === "dom"
    ? createXtermEmulators(undefined, () => { throw new Error("DOM renderer requested by observer"); })
    : createXtermEmulators();

  window.__terminals = new Map();
  render(() => <App app={app} reducedMotion={reducedMotion} clock={Date.now} createEmulator={(id) => {
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
      excluded: [{ source: "unavailable-conversation", reason: "Source unavailable: folder no longer exists.", title: null, last_activity_ms: 1700000000000n }],
    });
    controls.app.handlers["project.importCommit"] = ({ selections }) => ({
      outcomes: selections.map(({ source }, index) => index === 0
        ? { source, workstream: "backend", agent: "migrate", error: null }
        : { source, workstream: null, agent: null, error: "Source changed. Refresh and retry." }),
    });
  }

  const SELECTED = new Map([["door-stopped", "first-workstream"], ["door-report", "r1"], ["earlier-run", "earlier-agent"], ["decisions", "agent-1"]]);

  const selected = SELECTED.get(seed);

  if (selected) {
    const failure = railStorage(controls.app.opened.project!.path).write({ selected, collapsed: [] });

    if (failure !== null) throw new Error(failure);
  }

  window.__fake = controls;
  mount(controls.app);

  if (query.get("todos") === "worst") mountTodoWorstCase(controls);
}

