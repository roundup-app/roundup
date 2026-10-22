import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./App";
import { createReducedMotion } from "./app/reducedMotion";
import { createTauriApp } from "./app/tauri";
import "./tokens.css";
import "./styles.css";
import "./scrollbar.css";
import { trackScrollHover } from "./scrollHover";

trackScrollHover(document);

const root = document.getElementById("root");

if (!root) throw new Error("index.html has no #root element");

const app = createTauriApp();

const reducedMotion = createRoot(() => createReducedMotion((query) => window.matchMedia(query)));

// Only a build made with VITE_ROUNDUP_PERF carries the keystroke run and the frame run (U3010e); Vite drops the branch and the import from every other build (K1).
const keystrokes = import.meta.env.VITE_ROUNDUP_PERF
  ? await import("./perf/run").then(async ({ createKeystrokeRun }) => {
      const measured = (await app.projects()).at(-1);

      if (!measured) throw new Error("the keystroke run needs a Project open");

      const workload = import.meta.env.VITE_ROUNDUP_PERF_WORKLOAD;

      if (workload) {
        const { createFrameRun } = await import("./perf/frame_run");

        return createFrameRun(app.forProject(measured.path), workload);
      }

      return createKeystrokeRun(app.forProject(measured.path));
    })
  : null;

render(() => <App app={app} reducedMotion={reducedMotion} clock={Date.now} createEmulator={keystrokes?.createEmulator} />, root);

void keystrokes?.start();
