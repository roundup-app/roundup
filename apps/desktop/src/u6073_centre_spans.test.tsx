import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import * as v from "valibot";
import { App } from "./App";
import { createFakeApp } from "./testing/fakeApp";
import { fakeEmulators } from "./terminal/paneHarness";
import { storedValue, useBrowserStorage } from "./state/storage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = async (nativeFails = false) => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();

  if (nativeFails) {
    app.handlers["link.read"] = () => { throw new Error("native open failed"); };

    app.onNativeOpen = listener => {
      setTimeout(() => listener({ kind: "link", url: "roundup://x" }), 50);

      return () => {};
    };
  }

  app.add("/a");
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(document.querySelector(".project-tab")).not.toBeNull());

  return app;
};

const resizes = (app: { calls: { method: string }[] }) => app.calls.filter(call => call.method === "terminal.resize").length;

it("u6073a_nothing_above_the_centre_resizes_the_terminal", async () => {
  const app = await mount(true);
  const failures = (await screen.findByText(/native open failed/)).closest(".centre-failures")!;
  const frame = document.querySelector(".centre-frame")!;

  // The failure floats beside the centre frame; nothing else precedes it in flow.
  expect(frame.parentElement).toBe(failures.parentElement);
  expect(frame.previousElementSibling).toBe(failures);
  expect(resizes(app)).toBe(0);
});

it("u6073c_failures_float_with_actions_and_announcement", async () => {
  const app = await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });

  expect(await storedValue("u6073", v.string()).write("x")).not.toBeNull();

  const retry = await screen.findByRole("button", { name: /retry/i });
  const line = retry.closest(".storage-failure")!;

  expect(line.closest(".centre-failures")).not.toBeNull();
  expect(line.querySelector("[role=alert]")).not.toBeNull();
  fireEvent.click(retry);
  expect(resizes(app)).toBe(0);
});
