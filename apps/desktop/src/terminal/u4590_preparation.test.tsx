import { createRoot } from "solid-js";
import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createScreens } from "./screens";
import { connectFakeProject, fakeEmulators } from "./paneHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("u4590_unready_destination_fails_and_releases_only_its_preparation", async () => {
  const { connected } = await connectFakeProject([]);
  const { factory, made } = fakeEmulators();

  const { screens, dispose } = createRoot(dispose => ({
    dispose,
    screens: createScreens(connected, (id, copy) => {
      const emulator = factory(id, copy);
      emulator.prepare = () => new Promise(() => {});

      return emulator;
    }),
  }));

  const existing = screens.emulatorFor("existing");
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const pending = screens.prepare(document.createElement("div"));
  const rejected = expect(pending).rejects.toThrow();
  deadline.abort(new DOMException("Destination did not become ready", "TimeoutError"));
  await rejected;
  expect([...made.values()].filter(emulator => emulator.disposed)).toHaveLength(1);
  expect(screens.emulatorFor("existing")).toBe(existing);
  expect(made.get("existing")!.disposed).toBe(false);
  screens.dispose();
  dispose();
});
