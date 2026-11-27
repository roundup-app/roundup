import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { appLog } from "../app/log";
import { RpcError } from "../app/seam";
import { info, node } from "../testing/nodes";
import { notices } from "../testing/notices";
import { mountPane, subscribed } from "./paneHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const logged = (): string[] => {
  const lines: string[] = [];

  vi.spyOn(appLog, "write").mockImplementation(line => { lines.push(line); });

  return lines;
};

it("u8013a_a_stream_restart_failure_only_logs", async () => {
  const lines = logged();
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);
  let snapshots = 0;

  app.handlers["terminal.snapshot"] = () => {
    if (++snapshots > 1) throw new RpcError(-32603, "restart refused");

    return { cols: 100, rows: 30, after: 0, data: "" };
  };

  connected.rail.select("a");
  flush();
  await subscribed(app, "t-a");
  await vi.waitFor(() => expect(snapshots).toBe(1));
  app.emitGap("t-a", 0, 50);
  app.emitOutput("t-a", "late");
  await vi.waitFor(() => expect(lines.some(line => line.includes("restart refused"))).toBe(true));
  expect(notices("alert")).toHaveLength(0);
});

it("u8013a_a_write_failure_while_draining_output_only_logs", async () => {
  const lines = logged();
  const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);

  let snapshots = 0;

  app.handlers["terminal.snapshot"] = () => {
    snapshots++;

    return { cols: 100, rows: 30, after: 0, data: "" };
  };

  connected.rail.select("a");
  flush();
  await subscribed(app, "t-a");
  await vi.waitFor(() => expect(snapshots).toBe(1));
  await vi.waitFor(() => expect(emulators.get("t-a")?.size).toEqual({ cols: 100, rows: 30 }));
  const emulator = emulators.get("t-a");

  if (!emulator) throw new Error("no emulator");

  emulator.write = () => { throw new Error("write exploded"); };

  app.emitOutput("t-a", "more");
  await vi.waitFor(() => expect(lines.some(line => line.includes("write exploded"))).toBe(true));
  expect(notices("alert")).toHaveLength(0);
});

it("u8013a_a_failure_of_a_shown_terminal_still_shows_a_notice", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);

  app.handlers["terminal.snapshot"] = () => { throw new RpcError(-32603, "attach refused"); };

  connected.rail.select("a");
  flush();
  await screen.findByRole("alert", { name: /attach refused/ });
  expect(notices("alert")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("alert", { name: /attach refused/ });
});
