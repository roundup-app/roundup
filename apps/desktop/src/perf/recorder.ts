import type { KeystrokeSample } from "@contracts/terminal/KeystrokeSample";
import { calibrate } from "./calibration";
import type { Exchange } from "./calibration";
import type { ProjectCalls } from "../app/seam";
import type { WriteParams } from "@contracts/terminal/WriteParams";
import { fromBase64 } from "../terminal/base64";
import { createXtermEmulators } from "../terminal/emulator";
import type { RendererAddon } from "../terminal/emulator";
import { createKeystrokeProbe } from "./keystrokes";

/** The production observation wiring, shared by the native run and window-free proofs. */
export const createRecorder = (now: () => number, run: string, target: () => string | null, renderer?: () => RendererAddon) => {
  const probe = createKeystrokeProbe(now, "a", target, run);
  let webgl: boolean | null = null;

  const createEmulator = createXtermEmulators({
    input: probe.input,
    frame: probe.frame,
    encoding: probe.encoding,
    encoded: probe.encoded,
    arrived: probe.arrived,
    written: probe.written,
    rendered: probe.rendered,
    renderer: used => { webgl = used; },
  }, renderer);

  const traced = <T extends Pick<ProjectCalls, "rpc">>(calls: T): T => ({
    ...calls,
    rpc: (method, params) => {
      if (method !== "terminal.write") return calls.rpc(method, params);
      // SAFETY: the generated RPC contract ties params to method; TS cannot narrow that generic pair together.
      const { id, data } = params as WriteParams;
      const bytes = [...fromBase64(data)];

      probe.dispatched(id, bytes);

      return calls.rpc(method, params).finally(() => probe.replied(id, bytes));
    },
  });

  const report = (samples: KeystrokeSample[], exchanges: Exchange[], resolution: number, skip: number) => {
    const calibration = calibrate(exchanges, resolution);

    if ("error" in calibration) return calibration;

    probe.daemon(samples, calibration);

    return { ...probe.summary(skip), hops: probe.hops(skip), calibration, hop_uncertainty_ms: calibration.uncertainty_ms };
  };

  return { probe, createEmulator, traced, report, webgl: () => webgl };
};
