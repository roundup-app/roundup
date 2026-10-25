import { storageCopy } from "./copy/storage";
import { ReservedLine } from "./ink/ReservedLine";
import { initializeStorage } from "./state/storage";
import { createResource, createRoot, Show } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import { createReducedMotion } from "./app/reducedMotion";
import { createTauriApp } from "./app/tauri";
import "./tokens.css";
import "./styles.css";
import "./scrollbar.css";
import { trackScrollbars } from "./scrollHover";

trackScrollbars(document);

const root = document.getElementById("root");

if (!root) throw new Error("index.html has no #root element");

const tauri = createTauriApp();

const reducedMotion = createRoot(() => createReducedMotion((query) => window.matchMedia(query)));

// Build-time branches exclude each workload from normal bundles; idle never imports the typing/frame drivers.
const idle = import.meta.env.VITE_ROUNDUP_IDLE_PERF ? (await import("./perf/idle_run")).createIdleRun(tauri.recordIdleEvidence) : null;

const keystrokes = !import.meta.env.VITE_ROUNDUP_IDLE_PERF && import.meta.env.VITE_ROUNDUP_PERF
  ? await import("./perf/run").then(async ({ createKeystrokeRun }) => {
      const measured = (await tauri.projects()).at(-1);

      if (!measured) throw new Error("the keystroke run needs a Project open");

      const workload = import.meta.env.VITE_ROUNDUP_PERF_WORKLOAD;

      if (workload && workload !== "flood") {
        const { createFrameRun } = await import("./perf/frame_run");

        return createFrameRun(tauri.forProject(measured.path), workload, measured.path);
      }

      return createKeystrokeRun(tauri.forProject(measured.path), workload === "flood" ? "flood" : "idle");
    })
  : null;

const app = keystrokes?.traced(tauri) ?? tauri;

const RestoredApp = () => {
  const [result, { refetch }] = createResource(initializeStorage);

  return <Show when={!result.loading} fallback={<div class="storage-failure"><ReservedLine status={storageCopy.restoring} /></div>}>
    <Show when={result() === null} fallback={<div class="storage-failure"><ReservedLine message={result()}><button data-button="quiet" type="button" onClick={() => void refetch()}>{storageCopy.restoreRetry}</button></ReservedLine></div>}>
      <App app={app} reducedMotion={reducedMotion} clock={Date.now} createEmulator={idle?.createEmulator ?? keystrokes?.createEmulator} observeTerminal={idle?.selected} prepareIdle={idle?.prepare} />
    </Show>
  </Show>;
};

render(() => <RestoredApp />, root);

void keystrokes?.start();
