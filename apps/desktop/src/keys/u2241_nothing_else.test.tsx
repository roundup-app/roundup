import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs } from "../header/stripFixture";
import { agent } from "../testing/nodes";
import { CHORDS, pressOf } from "./chords";
import { endLeader } from "./registry";

afterEach(cleanup);

const KEPT = ["meta+KeyN", "meta+shift+KeyN", "meta+KeyT", "meta+KeyK", "meta+Slash"];

/** The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act in the Terminal screen (U101, U102), not at App scope. */
const TERMINALS_OWN = ["meta+KeyC", "meta+KeyV", "meta+Equal", "meta+Minus", "meta+Digit0", "meta+shift+Equal"];

const CODES = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `Key${letter}`)
  .concat([..."0123456789"].map((digit) => `Digit${digit}`), ["BracketLeft", "BracketRight", "Period", "Comma", "Backslash", "Slash", "Semicolon", "Quote", "Minus", "Equal", "Backquote", "Space"]);

const MODS: KeyboardEventInit[] = [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }, { altKey: true, shiftKey: true }, { metaKey: true, shiftKey: true },
  { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true }, { altKey: true, metaKey: true }];

it("u2241_no_other_chord_is_taken_at_app_scope", async () => {
  expect(CHORDS.filter((chord) => !chord.inRail && !chord.onAgent && !chord.inSwitcher).flatMap((chord) => chord.presses)).toEqual(KEPT);

  await openTabs({ api: [agent("a1", "idle", "x")] });

  const terminal = document.body.appendChild(document.createElement("textarea"));
  const reached: string[] = [];

  terminal.className = "xterm-helper-textarea";
  terminal.addEventListener("keydown", (press) => reached.push(pressOf(press)));
  terminal.focus();

  const sent: string[] = [];
  const taken: string[] = [];

  for (const mods of MODS) {
    for (const code of CODES) {
      const press = new KeyboardEvent("keydown", { code, key: code.replace(/^(Key|Digit)/, "").toLowerCase(), bubbles: true, cancelable: true, ...mods });
      const name = pressOf(press);

      if (KEPT.includes(name) || TERMINALS_OWN.includes(name)) continue;

      sent.push(name);
      terminal.dispatchEvent(press);
      endLeader();

      if (press.defaultPrevented) taken.push(name);
    }
  }

  expect(taken).toEqual([]);
  expect(reached).toEqual(sent);
  terminal.remove();
});
