import { afterAll, beforeAll, it } from "vitest";
import { browser, closeBrowser, openBrowser, read } from "./u484_support";
import { expectControlPressNeverDrags } from "./u7276_support";

beforeAll(openBrowser, 90_000);

afterAll(closeBrowser);

/** The worktree facts refresh on the App's coarse tick (15 s), so the chip renders within two waits; it shows while focus is in its row. */
const chip = async () => {
  await read("(() => { window.__fake.app.handlers['agent.worktreeState'] = () => ({ ahead: 2, behind: 0, dirty: false }); return true; })()");
  const rendered = "!!document.querySelector('.rail-row[data-id=\"worktree-agent\"] .worktree-chip')";
  await browser("wait", "--fn", rendered).catch(() => browser("wait", "--fn", rendered));
  await browser("eval", `document.querySelector('.rail-row[data-id="worktree-agent"]').focus()`);
};

const CONTROLS = [
  { control: "chip", seed: "resources", open: chip, target: '.rail-row[data-id="worktree-agent"] .worktree-chip' },
] as const;

it.each(CONTROLS)("u7276b_a_press_on_a_control_never_drags ($control)", expectControlPressNeverDrags, 60_000);
