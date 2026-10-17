import { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { OutputMessage } from "./seam";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

/** A Tauri host that records the output commands and keeps the channels it was given. */
const host = (offset = 7) => {
  const channels: Channel<ArrayBuffer | { gap: { from: number; to: number } }>[] = [];
  const stopped: unknown[] = [];

  mockIPC((command, args) => {
    if (command === "terminal_output" && args && "channel" in args && args.channel instanceof Channel) {
      channels.push(args.channel);

      return offset;
    }

    if (command === "terminal_output_stop") stopped.push(args);

    return null;
  });

  return { channels, stopped };
};

describe("x14 the Tauri output channel", () => {
  it("x14_app_adapter_passes_raw_buffers_unchanged_and_a_released_subscription_hears_nothing", async () => {
    const { channels, stopped } = host();
    const heard: OutputMessage[] = [];

    const subscription = await createTauriApp().forProject("/p").selectOutput("t1", (message) => heard.push(message));
    const raw = Uint8Array.of(0, 27, 255, 0xe2, 0x82);

    channels[0]?.onmessage(raw.buffer);
    channels[0]?.onmessage({ gap: { from: 5, to: 9 } });
    await subscription.release();
    channels[0]?.onmessage(Uint8Array.of(1).buffer);

    expect([subscription.offset, heard, stopped]).toEqual([7, [raw, { gap: { from: 5, to: 9 } }], [{ path: "/p", id: "t1" }]]);
    expect(heard[0]).toBeInstanceOf(Uint8Array);
  });

  it("x14_app_adapter_replacement_silences_the_old_subscription_and_its_release_stops_nothing", async () => {
    const { channels, stopped } = host();
    const app = createTauriApp().forProject("/p");
    const old: OutputMessage[] = [];
    const current: OutputMessage[] = [];

    const first = await app.selectOutput("t1", (message) => old.push(message));

    await app.selectOutput("t1", (message) => current.push(message));
    channels[0]?.onmessage(Uint8Array.of(1).buffer);
    channels[1]?.onmessage(Uint8Array.of(2).buffer);
    await first.release();

    expect([old, current, stopped]).toEqual([[], [Uint8Array.of(2)], []]);
  });
});
