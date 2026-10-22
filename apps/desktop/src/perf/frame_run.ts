import type { AppSeam } from "../app/seam";
import { toBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import { recordFrames } from "./frames";
import type { FrameReport } from "./frames";
import { READY, SETUP_BOUND_MS, appears, sleep, timerResolutionMs } from "./run";

/** The workloads of `docs/motion.md` whose actions the recorder drives itself. The others are reported invalid, never as a pass. */
const driven = new Set(["glyphs"]);

/**
 * The frame run of `scenarios/ui-motion.md` U3010e: in a build made with `VITE_ROUNDUP_PERF` and `VITE_ROUNDUP_PERF_WORKLOAD`,
 * `start` opens a Terminal, records the workload's frame intervals and writes one `FRAMES <json>` line through that Terminal.
 */
export const createFrameRun = (app: AppSeam, workload: string) => {
  let terminalId: string | null = null;
  let ready: () => void = () => {};

  const isReady = new Promise<void>((resolve) => (ready = resolve));

  const emulators = createXtermEmulators({
    written: (bytes) => {
      if (new TextDecoder().decode(bytes).includes(READY)) ready();
    },
    rendered: () => {},
    renderer: () => {},
  });

  const report = async (body: FrameReport | { error: string }) => {
    if (terminalId === null) throw new Error("no Terminal was opened to report through");

    const line = `FRAMES ${JSON.stringify(body)}\n`;

    await app.rpc("terminal.write", { id: terminalId, data: toBase64(new TextEncoder().encode(line)) });
  };

  const measure = async () => {
    const create = await appears(
      () => [...document.querySelectorAll("button")].find((button) => (button.textContent?.trim() === "new Workstream" || button.getAttribute("aria-label") === "Add Workstream") && button.getAttribute("aria-disabled") !== "true") ?? null,
      "the new Workstream button",
    );

    create.click();
    await appears(() => document.querySelector('[role="treeitem"][aria-selected="true"]'), "the new Workstream's selected row");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true }));
    await appears(() => document.querySelector("textarea.xterm-helper-textarea"), "the Terminal's input");
    await Promise.race([isReady, sleep(SETUP_BOUND_MS).then(() => Promise.reject(new Error(`the Terminal never printed ${READY}`)))]);

    await report(
      await recordFrames(
        { frame: (callback) => void requestAnimationFrame(callback), hidden: () => document.hidden },
        {
          workload,
          engine: /Chrome|Chromium/.test(navigator.userAgent) ? "chromium" : "webkit",
          timerResolutionMs: timerResolutionMs(),
          userAgent: navigator.userAgent,
        },
        async () => driven.has(workload),
      ),
    );
  };

  return {
    createEmulator: (id: string) => {
      terminalId = id;

      return emulators(id);
    },
    start: async () => {
      try {
        await measure();
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;

        await report({ error: failure.message });
      }
    },
  };
};
