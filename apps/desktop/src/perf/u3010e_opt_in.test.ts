import solid from "vite-plugin-solid";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const MARKER = "roundup-frame-recorder";

const bundled = async (): Promise<string> => {
  const built = await build({
    root: ".",
    configFile: false,
    plugins: [solid()],
    logLevel: "silent",
    build: { write: false },
  });

  return [built]
    .flat()
    .flatMap((output) => ("output" in output ? output.output : []))
    .map((file) => (file.type === "chunk" ? file.code : ""))
    .join("\n");
};

afterEach(() => vi.unstubAllEnvs());

describe("u3010e the recorder is opt-in at build time", () => {
  it("u3010e_a_normal_build_carries_no_trace_of_the_recorder", async () => {
    expect(await bundled()).not.toContain(MARKER);
  }, 60_000);

  it("u3010e_a_measurement_build_carries_it", async () => {
    vi.stubEnv("VITE_ROUNDUP_PERF", "1");
    vi.stubEnv("VITE_ROUNDUP_PERF_WORKLOAD", "glyphs");

    expect(await bundled()).toContain(MARKER);
  }, 60_000);
});
