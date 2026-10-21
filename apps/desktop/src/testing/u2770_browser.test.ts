import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u2770_pointer_and_keyboard_focus", async () => {
  for (const scheme of ["light", "dark"] as const) {
    const lane = await openLane(1512, scheme, "u2770");

    try {
      const pads = "#shelf-tab-pads";
      const focused = (selector: string) => `document.activeElement === document.querySelector(${JSON.stringify(selector)})`;
      const ring = () => lane.evaluate<string>("getComputedStyle(document.activeElement).outlineStyle");
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      expect(await ring()).toBe("none");
      await lane.capture("pointer-no-ring", "shelf-click");
      await lane.browser("press", "ArrowLeft");
      await lane.until(focused("#shelf-tab-todos"));
      expect(await ring()).toBe("solid");
      await lane.browser("press", "Tab");
      await lane.until("!!document.activeElement.closest('.shelf')");
      await lane.browser("press", "Shift+Tab");
      await lane.until(focused("#shelf-tab-todos"));
      expect(await ring()).toBe("solid");
      await lane.capture("pointer-no-ring", "shelf-keyboard");
      await lane.browser("click", pads);
      await lane.until(focused(pads));
      expect(await ring()).toBe("none");

      // Real pointer and Tab navigation, with no synthetic focus or replacement controls.
      for (const [selector, step] of [
        ['.project-tab .tab-name-button', 'project-tab'],
        ['.rail [data-id="tokens"].rail-row', 'rail-row'],
        ['.rail [data-id="tokens"] [aria-label="Open folder"]', 'icon-button'],
        ['.strip-add', 'button'],
      ]) {
        await lane.browser("click", selector!);
        await lane.until(focused(selector!));
        expect(await ring(), step).toBe("none");
        await lane.capture("pointer-no-ring", step!);
        await lane.browser("press", step === "rail-row" ? "ArrowUp" : "Shift+Tab");
        await lane.until(`!(${focused(selector!)})`);

        if (step === "rail-row") await lane.browser("press", "ArrowDown");
        else {
          // Focusing a Project tab reveals its close control, which becomes an intervening Tab stop.
          for (let stop = 0; stop < 8 && !(await lane.evaluate<boolean>(focused(selector!))); stop++) {
            await lane.browser("press", "Tab");
          }
        }

        await lane.until(focused(selector!));
        expect(await ring(), step).toBe("solid");
      }

      // Overview mounts a combobox: its library autofocus must not change pointer modality.
      await lane.browser("click", ".todo-project-root");
      await lane.until(focused(".todo-project-root"));
      expect(await ring()).toBe("none");

      await lane.browser("click", ".ask-input");
      await lane.until(focused(".ask-input"));
      expect(await ring()).toBe("none");
      await lane.capture("pointer-no-ring", "ask-click");

      for (const key of ["a", "ArrowLeft", "Backspace", "Control+a", "Alt+a"]) {
        await lane.browser("press", key);
        expect(await lane.evaluate<boolean>(focused(".ask-input"))).toBe(true);
        expect(await ring()).toBe("none");
      }

      await lane.capture("pointer-no-ring", "ask-typing");
      await lane.browser("press", "Tab");
      await lane.until(`!(${focused(".ask-input")})`);
      expect(await ring()).toBe("solid");

      // A real AlertDialog's first control is focused by its click opener.
      await lane.browser("hover", ".project-tab");
      await lane.until("!!document.querySelector('.project-tab .tab-close')");
      await lane.browser("click", ".project-tab .tab-close");
      const cancel = '[role="alertdialog"] button';

      await lane.until(focused(cancel));
      expect(await ring()).toBe("none");
      await lane.browser("press", "Tab");
      await lane.until(`!(${focused(cancel)})`);
      expect(await ring()).toBe("solid");
      await lane.browser("press", "Shift+Tab");
      await lane.until(focused(cancel));
      expect(await ring()).toBe("solid");
      await lane.browser("press", "Escape");
      await lane.until("!document.querySelector('[role=alertdialog]')");

      for (const opener of ['[aria-label="Add Workstream"]', '.terminal-new']) {
        await lane.browser("click", opener);
        await lane.until("document.activeElement?.matches('.xterm-helper-textarea')");
        expect(await ring(), opener).toBe("none");
        // A modified App shortcut opens and focuses another Terminal, including after pointer-driven Terminal focus.
        const previous = await lane.evaluate<string>("document.activeElement.closest('[data-bubble]')?.dataset.bubble ?? 'pane'");

        await lane.browser("press", "Meta+t");
        await lane.until(`document.activeElement?.matches('.xterm-helper-textarea') && document.activeElement.closest('[data-bubble]')?.dataset.bubble !== ${JSON.stringify(previous)}`);
        expect(await ring()).toBe("solid");
      }

      const terminalTab = '.terminal-tab-pair:last-of-type .terminal-tab';
      await lane.browser("click", terminalTab);
      await lane.until(focused(terminalTab));
      expect(await ring()).toBe("none");
      await lane.capture("pointer-no-ring", "terminal-tab");
      await lane.browser("press", "Shift+Tab");
      await lane.until(`!(${focused(terminalTab)})`);
      await lane.browser("press", "Tab");
      await lane.until(focused(terminalTab));
      expect(await ring()).toBe("solid");

      await lane.browser("reload");
      await lane.until("!!document.querySelector('.shelf-tabs')");
      await lane.browser("press", "Tab");
      await lane.until(focused(".project-tab .tab-name-button"));
      expect(await ring()).toBe("solid");
      await lane.browser("click", ".strip-add");
      await lane.until(focused(".strip-add"));
      expect(await ring()).toBe("none");
    } finally { await lane.close(); }
  }
}, 240_000);
