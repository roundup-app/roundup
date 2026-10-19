import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfigFromFile } from "vite";

test("w2889_native_config_loads", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    undefined,
    undefined,
    undefined,
    "native",
  );

  assert.ok(loaded, "native loader returns the desktop configuration");
  assert.equal(loaded.config.server.port, 5173);
  assert.equal(loaded.config.test.sequence.sequencer.name, "TimedSequencer");
});
