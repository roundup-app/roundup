import { afterEach, describe, expect, it } from "vitest";
import terminalStyles from "./styles.css?inline";
import { createXtermEmulators } from "./emulator";
import { runChecks } from "../testing/checks";
import { withStylesheets } from "../testing/contrast";

// jsdom has no `matchMedia`, which xterm reads when it opens.
class NeverMatches extends EventTarget implements MediaQueryList {
  matches = false;
  onchange = null;

  constructor(readonly media: string) {
    super();
  }

  addListener() {}

  removeListener() {}
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style").forEach((sheet) => sheet.remove());
});

describe("u59 the terminal passes the checks", () => {
  it("u59_a_selected_terminal_passes_d1_d6_and_d7", async () => {
    window.matchMedia ??= (media) => new NeverMatches(media);

    await withStylesheets(async () => {
      document.head.appendChild(document.createElement("style")).textContent = terminalStyles;
      const host = document.body.appendChild(document.createElement("div"));
      host.className = "pane";
      createXtermEmulators()("t").show(host);
      await Promise.resolve();
      const checks = runChecks();

      expect([checks.D1, checks.D6, checks.D7].map((check) => [check.status, check.selector])).toEqual([["pass", ""], ["pass", ""], ["pass", ""]]);
    });
  });
});
