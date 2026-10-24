import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

// D-Bus is a Linux startup dependency; macOS Chromium does not use it.
it.runIf(process.platform === "linux")("u26_parallel_pages_answer_while_the_host_session_bus_holds_authentication", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-bus-"));
  const sockets = new Set<Socket>();

  // Accept authentication bytes but never acknowledge them. This is a stalled
  // external dependency, not a slow browser or a probabilistic startup race.
  const bus = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.resume();
  });

  await new Promise<void>((resolve, reject) => {
    bus.once("error", reject);
    bus.listen(join(dir, "bus"), resolve);
  });

  vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", `unix:path=${join(dir, "bus")}`);
  const pages = await Promise.allSettled(Array.from({ length: 2 }, () => openPage(found)));

  try {
    const opened = pages.map((page) => {
      if (page.status === "rejected") throw page.reason;

      return page.value;
    });

    expect(await Promise.all(opened.map((page) => page.call<number>("() => 42")))).toEqual([42, 42]);
  } finally {
    // Release the stalled dependency before teardown, even on an unpatched head.
    for (const socket of sockets) socket.destroy();
    await Promise.all(pages.map((page) => page.status === "fulfilled" ? page.value.close() : undefined));
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => bus.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 40_000);
