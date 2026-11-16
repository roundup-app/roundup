import { execFileSync } from "node:child_process";
import { batch, browser, url } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

export const captureSha = captureDir("U5704a") ? process.env.ROUNDUP_CAPTURE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : undefined;

export const headingHitAreas = `Array.from(document.querySelectorAll('details[data-pad-heading] summary')).filter(s => s.checkVisibility()).map(s => {
        const r = s.getBoundingClientRect();
        const x = r.left + r.width / 2;
        let hitHeight = 0;
        for (let y = r.top; y < r.bottom; y += 0.25) {
          if (document.elementFromPoint(x, y + 0.125) === s) hitHeight += Math.min(0.25, r.bottom - y);
        }
        return { name: s.ariaLabel, level: s.closest('h1,h2,h3,h4,h5,h6').tagName, expanded: s.getAttribute('aria-expanded'), height: r.height, hitHeight, focused: s.matches(':focus-visible'), hovered: s.matches(':hover') };
      })`;

// One CLI connection for the three setup commands; each still runs in order and a failed one stops the batch.
export const opened = (path: string) => browser("batch", "--bail", "set viewport 1512 950", "set media dark", `open '${url(path)}'`);

const focusPad = `(() => { document.querySelector('.pads-tab [data-pad="pad-3"] .pad-name').focus(); return true; })()`;

// Focus the pad-3 row, open it and wait for the page condition in one CLI connection.
export const openPad = (until: string) => batch([["eval", focusPad], ["press", "Enter"], ["wait", "--fn", until]]);

export const source = "Ready to review.\n\n<details>\n<summary>For Agents</summary>\n\nPath: `日本語/café`\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n~~~text\nraw evidence\n~~~\n\n</details>";
