import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

export let lane: LaneBrowser;

/** The Create-menu observers' lane; `recording` is the directory its `creation.webm` goes to, or null for no recording. */
export const openCreateLane = async (recording: string | null = null) => {
  lane = await openLane(1512, "dark", "u5555", false, null);

  if (recording) {
    mkdirSync(recording, { recursive: true });
    await lane.browser("record", "restart", join(recording, "creation.webm"));
  }
};

export const closeCreateLane = async (recording: string | null = null) => {
  try { if (recording) await lane?.browser("record", "stop"); }
  finally { await lane?.close(); }
};

export const fresh = async (seed: string) => {
  await lane.seedTodos([], false, seed);
  await lane.evaluate("(async () => { const { saveAppSettings } = await import('/src/settings/preferences.ts'); await saveAppSettings({ mode: 'dark' }); return true; })()");
};

// CI5527b: each action and the wait that settles it share one CLI connection; a step stops the batch where it fails.
export const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

export const wait = (predicate: string) => `wait --fn ${quote(predicate)}`;

export const run = async (...commands: string[]) => {
  // A failed step exits non-zero; its reply on stdout names the step.
  const out = await lane.browser("--json", "batch", "--bail", ...commands).catch((error: { stdout?: string; message: string }) => { throw new Error(`${error.stdout ?? ""}\n${error.message.slice(0, 200)}`); });
  const replies: { success: boolean; error?: string }[] = JSON.parse(out);
  const failed = replies.find(reply => !reply.success);

  if (failed) throw new Error(failed.error);
};

export const menuClosed = "!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('aria-label') === 'Create'";

// The menu takes focus a frame after it mounts; a key pressed before then goes nowhere.
// Accepted change 1: opening a menu focuses its first item, so focus sits inside the menu, not on it.
export const menuFocused = "!!document.activeElement?.closest('[role=menu]')";

const kinds = [["agent", "Meta+n"], ["workstream", "Alt+Meta+n"], ["mode", "Shift+Meta+m"]] as const;

export const cases = ["empty-project", "tree-40"].flatMap(seed => kinds.map(([kind, chord], index) => ({ seed, kind, index, chord })));
