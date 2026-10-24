import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { underSettings } from "../testing/media";
import type { Setting } from "../testing/media";
import { seedApp } from "../testing/seeds";
import type { Controls, SeedName } from "../testing/seeds";
import xtermCss from "@xterm/xterm/css/xterm.css?inline";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

const SHEETS = [xtermCss, appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss].join("\n");

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

  // App.tsx renders the chooser after projects.loaded(), and the Rail only
  // after connectProject has awaited rail.settled(). Reopen publishes the exit.
  const ready = () => seed === "first-run"
    ? screen.queryByRole("button", { name: "Choose folder…" }) !== null
    : screen.queryByRole("tree") !== null
      && (seed !== "daemon-exits" || screen.queryByRole("button", { name: "Reopen" }) !== null);

  await new Promise<void>((done, reject) => {
    const observer = new MutationObserver(() => {
      if (!ready()) return;

      observer.disconnect();
      clearTimeout(guard);
      done();
    });

    const guard = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`U136 waiting for ${seed === "first-run" ? "folder chooser" : seed === "daemon-exits" ? "Rail and daemon-exit reopen action" : "connected Rail"}`));
    }, 2000);

    observer.observe(document.body, { childList: true, subtree: true });

    if (ready()) {
      observer.disconnect();
      clearTimeout(guard);
      done();
    }
  });
};

describe("u136 the existing screens", () => {
  it("u136_observer_waits_for_the_published_daemon_exit", async () => {
    vi.useFakeTimers();
    const controls = seedApp("daemon-exits", Date.now());
    const exit = controls.app.exitDaemon;
    let release = () => {};

    let kept!: () => void;
    const requested = new Promise<void>((done) => { kept = done; });
    controls.app.exitDaemon = (ending, path) => {
      release = () => exit(ending, path);
      kept();
    };

    let observed = false;
    const observation = mount("daemon-exits", [], controls).then(() => { observed = true; });

    try {
      await vi.advanceTimersByTimeAsync(0);
      await requested;
      // The former observer completed at 50 ms even while the exit was delayed.
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
});
