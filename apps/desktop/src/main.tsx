import { StorageRecovery } from "./app/StorageRecovery";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { CapturePanel } from "./todos/CapturePanel";
import { App } from "./App";
import { createReducedMotion } from "./app/reducedMotion";
import { createTauriApp, followMaterial } from "./app/tauri";
import "./tokens.css";
import "./styles.css";
import "./scrollbar.css";
import { trackScrollbars } from "./scrollHover";

trackScrollbars(document);

const root = document.getElementById("root");

if (!root) throw new Error("index.html has no #root element");

const tauri = createTauriApp();

// Native preferences must open before any ordinary App surface or editor mounts.
if (!new URLSearchParams(location.search).has("capture")) await tauri.projects();

if (!new URLSearchParams(location.search).has("capture")) {
  void followMaterial(document.documentElement).catch(error => console.error(error));
}

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

        return createFrameRun(tauri.forProject(measured.path), workload, measured.path, reducedMotion);
      }

      return createKeystrokeRun(tauri.forProject(measured.path), workload === "flood" ? "flood" : "idle", measured.path);
    })
  : null;

// Opt-in at build time (SP1): the Switcher and switch marks exist only in a perf build and are read from `window`.
if (!import.meta.env.VITE_ROUNDUP_IDLE_PERF && import.meta.env.VITE_ROUNDUP_PERF) {
  const { createSwitchProbe, SWITCH_PROBE } = await import("./perf/switch");
  const probe = createSwitchProbe(() => performance.now());

  probe.start();
  Object.assign(window, { [SWITCH_PROBE]: probe });
}

const app = keystrokes?.traced(tauri) ?? tauri;

// The panel never initializes storage, opens Projects or mounts another App.
if (new URLSearchParams(location.search).has("capture") && tauri.capture) {
  render(() => <CapturePanel port={tauri.capture!} />, root);
} else render(() => <StorageRecovery>
  <App app={app} reducedMotion={reducedMotion} clock={Date.now} createEmulator={idle?.createEmulator ?? keystrokes?.createEmulator} observeTerminal={idle?.selected} prepareIdle={idle?.prepare} />
</StorageRecovery>, root);

void keystrokes?.start();
