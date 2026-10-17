import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { CHECK_IDS, runChecks } from "../testing/checks";
import { underSettings } from "../testing/media";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";

const uiCss = Object.values(import.meta.glob<string>("../ui/*.css", { query: "?inline", import: "default", eager: true })).join("\n");

import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
});

const sheets = [tokenCss, appCss, uiCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss].join("\n");

const mount = async (dark = false) => {
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = dark ? underSettings(sheets, ["dark"]) : sheets;

  window.matchMedia = (query) => ({ matches: dark && query.includes("prefers-color-scheme: dark"), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });

  const controls = seedApp("door-stopped", Date.now());

  render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} />);
  fireEvent.click(await screen.findByText("first workstream"));
  await screen.findByText("Supervisor stopped, exited 0");
};

// The Checks that pass on main for this screen in both schemes (the base captures of U161); D1, D6, D7 and D10 fail there too.
// D5 needs painted boxes: u161_checks_<scheme>_d5_on_painted_layout_at_<width>_by_800 in u137_checks.test.tsx retains both schemes.
const PASSING_ON_MAIN = new Set(["D2", "D3", "D4", "D8", "D9"]);

describe("u161 the first window reads as designed", () => {
  for (const [scheme, dark] of [["light", false], ["dark", true]] as const)
    it(`u161_checks_${scheme}_regress_nothing_that_passed_on_main`, async () => {
      await mount(dark);
      const checks = runChecks();

      for (const id of CHECK_IDS) if (PASSING_ON_MAIN.has(id)) expect(checks[id], `${id} ${JSON.stringify(checks[id])}`).toMatchObject({ status: "pass" });
    });
});
