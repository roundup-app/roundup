import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { CHECK_IDS, runChecks } from "../testing/checks";
import { underSettings } from "../testing/media";
import type { Setting } from "../testing/media";
import { seedApp } from "../testing/seeds";
import type { Controls, SeedName } from "../testing/seeds";
import xtermCss from "@xterm/xterm/css/xterm.css?inline";
import tokenCss from "../tokens.css?inline";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

const SHEETS = [xtermCss, appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss].join("\n");

const SEEDS: SeedName[] = ["first-run", "agents-10", "tree-40", "daemon-exits", "conflict"];

const SCHEMES: Setting[][] = [[], ["dark"]];

let sheet: HTMLStyleElement | undefined;

let tokens: HTMLStyleElement | undefined;

let matchMedia: typeof window.matchMedia | undefined;

afterEach(() => {
  sheet?.remove();
  tokens?.remove();

  if (matchMedia) window.matchMedia = matchMedia;
  matchMedia = undefined;
  cleanup();
  vi.useRealTimers();
});

const mount = async (seed: SeedName, settings: Setting[], controls: Controls = seedApp(seed, Date.now())) => {
  tokens = document.head.appendChild(document.createElement("style"));
  tokens.dataset.viteDevId = "/src/tokens.css";
  tokens.textContent = underSettings(tokenCss, settings);
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = underSettings(SHEETS, settings);
  matchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: settings.includes("dark") && query.includes("prefers-color-scheme: dark"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });

  render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} />);
  await screen.findByRole("tree", {}, { timeout: 2000 }).catch(() => undefined);
  await new Promise((done) => setTimeout(done, 50));
};

describe("u136 the existing screens pass", () => {
  it("u136_observer_waits_for_the_published_daemon_exit", async () => {
    vi.useFakeTimers();
    const controls = seedApp("daemon-exits", Date.now());
    const exit = controls.app.exitDaemon;
    let release = () => {};
    let held!: () => void;
    const requested = new Promise<void>((done) => { held = done; });
    controls.app.exitDaemon = (ending, path) => {
      release = () => exit(ending, path);
      held();
    };
    let observed = false;
    const observation = mount("daemon-exits", [], controls).then(() => { observed = true; });

    try {
      await vi.advanceTimersByTimeAsync(0);
      await requested;
      // The former observer completed at 50 ms even while the exit was held.
      await vi.advanceTimersByTimeAsync(50);
      expect(observed).toBe(false);
      release();
      await observation;
      expect(screen.getByRole("button", { name: /reopen/i })).toBeTruthy();
    } finally {
      release();
      await observation;
    }
  });
  for (const seed of SEEDS) {
    for (const settings of SCHEMES) {
      it(`u136_${seed.replace("-", "_")}_${settings.join("") || "light"}_passes_d1_to_d10`, async () => {
        await mount(seed, settings);
        const checks = runChecks();

        // D12 and D14 measure the Shelf rows' boxes, which jsdom has none of (U360); the harness page measures them.
        for (const id of CHECK_IDS.filter((one) => one !== "D12" && one !== "D14")) expect(checks[id], `${id} ${JSON.stringify(checks[id])} on ${seed} ${settings.join() || "light"}`).toMatchObject({ status: "pass" });
      // Dense jsdom style measurements need time to return their Check results.
      }, 15_000);
    }
  }
});
