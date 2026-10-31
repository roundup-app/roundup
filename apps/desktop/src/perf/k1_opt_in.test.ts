import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const bundled = async (): Promise<string> => {
  const built = await build({
    root: ".",
    configFile: "vite.config.ts",
    logLevel: "silent",
    build: { write: false },
  });

  const outputs = [built].flat();

  return outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .map((file) => (file.type === "chunk" ? file.code : ""))
    .join("\n");
};

// Each build is slow, so the four opt-in cases (K1's probe, U3010e's recorder) share two.
const once = <T,>(make: () => Promise<T>) => {
  let made: Promise<T> | undefined;

  return () => (made ??= make());
};

const normal = once(bundled);

const measurement = once(() => {
  vi.stubEnv("VITE_ROUNDUP_PERF", "1");
  vi.stubEnv("VITE_ROUNDUP_PERF_WORKLOAD", "glyphs");

  return bundled();
});

afterEach(() => vi.unstubAllEnvs());

describe("k1 and u3010e the probes are opt-in at build time", () => {
  it("k1_a_normal_build_carries_no_trace_of_the_probe", async () => {
    expect(await normal()).not.toContain("roundup-keystroke-probe");
  }, 60_000);

  it("sp1_a_normal_build_carries_no_trace_of_the_switch_probe", async () => {
    expect(await normal()).not.toContain("roundup-switch-probe");
  }, 60_000);

  it("sp1_a_build_made_with_VITE_ROUNDUP_PERF_carries_the_switch_probe", async () => {
    expect(await measurement()).toContain("roundup-switch-probe");
  }, 60_000);

  it("u3010e_a_normal_build_carries_no_trace_of_the_recorder", async () => {
    expect(await normal()).not.toContain("roundup-frame-recorder");
  }, 60_000);

  it("r24_a_normal_build_excludes_the_idle_producer_and_its_native_command", async () => {
    expect(await normal()).not.toContain("record_idle_evidence");
  }, 60_000);

  it("k1_a_build_made_with_VITE_ROUNDUP_PERF_carries_it", async () => {
    expect(await measurement()).toContain("roundup-keystroke-probe");
  }, 60_000);

  it("u3010e_a_measurement_build_carries_it", async () => {
    expect(await measurement()).toContain("roundup-frame-recorder");
  }, 60_000);
});

it("r24_an_idle_build_carries_evidence_without_typing_or_frame_drivers", async () => {
  vi.stubEnv("VITE_ROUNDUP_IDLE_PERF", "1");
  vi.stubEnv("VITE_ROUNDUP_PERF", "1");

  const code = await bundled();

  expect(code).toContain("record_idle_evidence");
  expect(code).not.toContain("roundup-keystroke-probe");
  expect(code).not.toContain("roundup-frame-recorder");
}, 60_000);
