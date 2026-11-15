import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const TERMINAL = "t-agent-3";

const write = (text: string) =>
  read(
    `new Promise(resolve => window.__terminals.get('${TERMINAL}').write(new TextEncoder().encode(${JSON.stringify(text)}), resolve))`,
  );

const drawn = (text: string) =>
  `[...document.querySelectorAll('.pane-host .xterm-rows')].some(rows => rows.textContent.includes('${text}'))`;

/** xterm pauses from an `IntersectionObserver` notification; this observer is made after xterm's, so it is told once xterm has been. */
const outsideViewport = () =>
  read(`new Promise(resolve => {
    const observer = new IntersectionObserver(entries => {
      if (entries.at(-1).isIntersecting) return;
      observer.disconnect();
      resolve(true);
    });
    observer.observe(document.querySelector('.pane-host .xterm-screen'));
  })`);

/** A render xterm had queued has run by the second frame. */
const frames = () =>
  read(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );

it("ip7168d_a_hidden_panes_terminal_parses_output_and_draws_nothing_until_shown", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser(
    "open",
    url("/harness.html?rest=1&tabs=1&seed=agents-10&renderer=dom"),
  );
  await wait(
    "!!window.__fake && !!document.querySelector('.rail-row[data-id=\"agent-3\"]')",
  );
  await read(
    "document.querySelector('.rail-row[data-id=\"agent-3\"]').click()",
  );
  await wait(
    `window.__terminals.has('${TERMINAL}') && !!document.querySelector('.pane-host:not([data-inactive]) .xterm-screen')`,
  );
  await read(`window.__terminals.get('${TERMINAL}').ready`);

  // A shown Terminal draws what it is sent, so a later absence is the pause and not a page that cannot draw.
  await write("\x1b[2J\x1b[HSHOWNMARK7168");
  await wait(drawn("SHOWNMARK7168"));

  // The same state the App gives a Project that is not selected (U7155a).
  await read(
    "document.querySelector('.pane-host').setAttribute('data-inactive', '')",
  );
  await outsideViewport();
  await write("\r\nHIDDENMARK7168");
  await frames();

  expect(
    await read<string>(
      `window.__terminals.get('${TERMINAL}').serialize().data`,
    ),
  ).toContain("HIDDENMARK7168");
  expect(await read<boolean>(drawn("HIDDENMARK7168"))).toBe(false);

  // Shown by the attribute alone: the draw lands in the same task, before any frame.
  expect(
    await read<boolean>(`(async () => {
      document.querySelector('.pane-host').removeAttribute('data-inactive');
      await Promise.resolve();
      return ${drawn("HIDDENMARK7168")};
    })()`),
  ).toBe(true);
}, 60_000);
