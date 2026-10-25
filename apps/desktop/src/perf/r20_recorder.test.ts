import { afterEach, expect, it, vi } from "vitest";
import * as xterm from "@xterm/xterm";
import { createRoot } from "solid-js";
import { createRecorder } from "./recorder";
import { calibrate } from "./calibration";
import { createScreens } from "../terminal/screens";
import { connectFakeProject, subscribed } from "../terminal/paneHarness";
import { info, terminal as node } from "../testing/nodes";
import { fromBase64 } from "../terminal/base64";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("r20_hop_report_accounts_for_the_echo_round_trip", async () => {
  let at = 0;
  const renders: (() => void)[] = [];
  const render = () => renders.forEach(callback => callback());
  const RealTerminal = xterm.Terminal;

  vi.spyOn(xterm, "Terminal").mockImplementation(function (options) {
    const terminal = new RealTerminal(options);

    Object.defineProperty(terminal, "onRender", { value: (callback: (event: { start: number; end: number }) => void) => {
      renders.push(() => callback({ start: 0, end: 0 }));

      return { dispose() {} };
    } });

    return terminal;
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const recorder = createRecorder(() => at, "test", () => "t-a", () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const emulator = recorder.createEmulator("t-a");
  const screens = createRoot(() => createScreens({ ...connected, app: recorder.traced(connected.app) }, () => emulator));
  const host = document.body.appendChild(document.createElement("div"));

  screens.show("t-a", host);
  await subscribed(app, "t-a");
  // Finish the empty snapshot before observation; it must never count as echo evidence.
  await new Promise<void>(resolve => emulator.write(new Uint8Array(), resolve));

  const output = async (bytes: Uint8Array) => {
    app.emitBytes("t-a", bytes);
    // xterm's callback after the empty write also acknowledges all earlier queued output.
    await new Promise<void>(resolve => emulator.write(new Uint8Array(), resolve));
  };

  let release!: () => void;
  let dispatched!: () => void;
  const dispatchedInput = new Promise<void>(resolve => { dispatched = resolve; });
  const writes: Uint8Array[] = [];

  app.handlers["terminal.write"] = ({ data }) => {
    writes.push(fromBase64(data));

    if (writes.length === 1) return new Promise<null>(resolve => { release = () => resolve(null); });
    dispatched();

    return null;
  };

  // One older write holds the production queue, so this key cannot encode until its reply.
  emulator.paste("hold");
  void recorder.probe.keydown();
  at = 2;
  emulator.paste("a");
  at = 9;
  release();
  await dispatchedInput;
  at = 10;
  await output(new TextEncoder().encode("noise a"));
  render();
  expect(recorder.probe.summary(0).n).toBe(0);
  at = 17;
  const echo = writes[1]!;

  await output(echo.subarray(0, 7));
  render();
  expect(recorder.probe.summary(0).n).toBe(0);
  await output(echo.subarray(7, -1));
  render();
  expect(recorder.probe.summary(0).n).toBe(0);
  await output(echo.subarray(-1));
  at = 22;
  render();

  const report = JSON.parse(JSON.stringify(recorder.report(
    [{ token: "\x1b]777;test-0\x07a", received: 110, written: 114, read: 116, ambiguous: false }],
    [{ sent: 0, daemon: 101, received: 2 }, { sent: 30, daemon: 131, received: 32 }], 1, 0,
  )));

  expect(report).toMatchObject({ n: 1, dropped: 0, p50: 22, calibration: { offset_ms: 100, uncertainty_ms: 2 }, hops: {
    keydown_to_input: { n: 1, p50: 2, p95: 2 }, input_to_encoding: { n: 1, p50: 7, p95: 7 },
    input_to_dispatch: { n: 1, p50: 7, p95: 7 },
    input_to_encoded: { n: 1, p50: 7, p95: 7 }, encoding_to_encoded: { n: 1, p50: 0, p95: 0 },
    encoded_to_dispatch: { n: 1, p50: 0, p95: 0 }, dispatch_to_echo_event: { n: 1, p50: 8, p95: 8 },
    write_reply: { n: 1, p50: 1, p95: 1 }, dispatch_to_daemon: { n: 1, p50: 1, p95: 1 },
    daemon_to_write: { n: 1, p50: 4, p95: 4 }, write_to_echo_read: { n: 1, p50: 2, p95: 2 },
    echo_read_to_event: { n: 1, p50: 1, p95: 1 }, echo_event_to_parsed: { n: 1, p50: 0, p95: 0 },
    parsed_to_frame: { n: 1, p50: 5, p95: 5 },
  } });
  // A dropped identity's late echo cannot finish the following key, even though both visibly type a.
  void recorder.probe.keydown();
  at = 24;
  emulator.paste("a");
  recorder.probe.abandon();
  const late = writes.at(-1)!;

  void recorder.probe.keydown();
  await output(late);
  render();
  recorder.probe.abandon();
  expect(recorder.probe.summary(0)).toMatchObject({ n: 1, dropped: 2 });
  screens.dispose();
});

it("r20_calibration_rejects_invalid_or_incompatible_clock_evidence", () => {
  for (const exchanges of [[], [{ sent: 2, daemon: 100, received: 1 }, { sent: 3, daemon: 101, received: 4 }],
    [{ sent: 0, daemon: 100, received: 2 }, { sent: 30, daemon: 1000, received: 32 }]]) {
    expect(calibrate(exchanges, 1)).toMatchObject({ error: expect.any(String) });
  }
});
