import { beforeAll, expect, it } from "vitest";
import { browser, read } from "../ui/tabsBrowser";
import { drag, placement, setViewport } from "./u514Browser";

beforeAll(setViewport);

const LINES = ["prompt line", "- diff line", " inverse status ", "plain text here", "wide plain text ".repeat(8), "last"];

const OUTPUT = `\x1b[2J\x1b[H\x1b[44m${LINES[0]}\x1b[0m\r\n\x1b[41m${LINES[1]}\x1b[0m\r\n\x1b[31;7m${LINES[2]}\x1b[0m\r\n${LINES[3]}\r\n${LINES[4]}\r\n${LINES[5]}`;

type Cell = { bg: string; ink: string; glyph: boolean };

type Painted = { rows: Cell[][]; selection: string; foreground: string; end: number };

/** Each cell of the first five rows as the renderer drew it: the background it paints and the colour of its glyph. */
const paintedCells = (selector: string, lines: string[]) => read<Painted>(`new Promise(resolve => { window.__emu.redraw(); requestAnimationFrame(() => {
  const screen = document.querySelector(${JSON.stringify(selector)});
  const { cols, rows } = window.__emu.serialize();
  const box = screen.getBoundingClientRect();
  const cw = box.width / cols, ch = box.height / rows;
  const lines = ${JSON.stringify(lines)};
  const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  const rgb = css => { const m = css.match(/\\d+/g).map(Number); return hex(m[0], m[1], m[2]); };
  const canvas = screen.querySelector('canvas:not(.xterm-link-layer)');
  let context;
  if (canvas) { const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; context = copy.getContext('2d'); context.drawImage(canvas, 0, 0); }
  const spans = [...screen.querySelectorAll('.xterm-rows span')];
  const cell = (row, col) => {
    const glyph = (lines[row] ?? '')[col]?.trim() !== undefined && !!(lines[row] ?? '')[col]?.trim();
    if (context) {
      const x = Math.floor(col * cw), y = Math.floor(row * ch);
      const data = context.getImageData(x, y, Math.floor(cw), Math.floor(ch)).data;
      const bg = hex(data[0], data[1], data[2]);
      let ink = bg, best = 0;
      for (let i = 0; i < data.length; i += 4) {
        const far = Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]);
        if (far > best) { best = far; ink = hex(data[i], data[i + 1], data[i + 2]); }
      }
      return { bg, ink, glyph };
    }
    const px = box.left + (col + 0.5) * cw, py = box.top + (row + 0.5) * ch;
    const at = spans.find(el => { const r = el.getBoundingClientRect(); return r.left <= px && px < r.right && r.top <= py && py < r.bottom; });
    const overlay = at ? undefined : [...screen.querySelectorAll('.xterm-selection div')].find(el => { const r = el.getBoundingClientRect(); return r.left <= px && px < r.right && r.top <= py && py < r.bottom; });
    const style = (at || overlay) && getComputedStyle(at || overlay);
    return { bg: style ? rgb(style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(screen.closest('.xterm')).backgroundColor : style.backgroundColor) : '', ink: style ? rgb(style.color) : '', glyph };
  };
  const root = getComputedStyle(document.documentElement);
  const token = name => root.getPropertyValue('--terminal-' + name).trim();
  resolve({
    rows: [0, 1, 2, 3, 4].map(row => Array.from({ length: cols }, (_, col) => cell(row, col))),
    selection: token('selection'), foreground: token('selection-text'), end: 0,
  });
})})`);

// Glyph edges are antialiased, so the farthest pixel of a glyph only comes near its colour.
const near = (a: string | undefined, b: string | undefined, slack = 24) => !!a && !!b && [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= slack);

const render = async (where: "agent" | "door" | "bubble", renderer: "dom" | "webgl", active: boolean) => {
  const selector = await placement(where, false, OUTPUT, false, renderer);

  await browser("set", "media", "dark");

  const box = await read<{ x: number; y: number; cw: number }>(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left, y: b.top, cw: b.width / window.__emu.serialize().cols }; })()`);
  const to = { x: Math.round(box.x + 300), y: Math.round(box.y + 90) };

  await drag({ x: Math.round(box.x + 3), y: Math.round(box.y + 3) }, to);

  if (!active) await browser("eval", "document.activeElement?.blur()");

  return { selector, box, painted: await paintedCells(selector, LINES), endCol: Math.floor(300 / box.cw) };
};

/** Every cell that does not paint the selection colour under its glyph, or that paints it past the drag. */
const misses = ({ painted, endCol }: Awaited<ReturnType<typeof render>>) => {
  const full = (colour: string) => colour.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3");
  const selection = full(painted.selection);
  const foreground = full(painted.foreground);
  const problems: string[] = [];

  painted.rows.forEach((row, index) => {
    // Rows above the last are selected to their end; the last row to the cell under the pointer.
    const last = index === painted.rows.length - 1 ? endCol - 2 : row.length - 1;

    row.forEach(({ bg, ink, glyph }, col) => {

      if (col <= last && !near(bg, selection)) problems.push(`row ${index} col ${col} paints ${bg}, not ${selection}`);

      if (col <= last && glyph && !near(ink, foreground, 64)) problems.push(`row ${index} col ${col} glyph is ${ink}, not ${foreground}`);

      if (index === painted.rows.length - 1 && col >= endCol + 2 && near(bg, selection)) problems.push(`row ${index} col ${col} lies past the drag`);
    });
  });

  return problems;
};

it.each([["dom"], ["webgl"]] as const)("u7640a_selected_cells_show_text_on_one_selection_background_%s", async (renderer) => {
  const result = await render("agent", renderer, true);

  // U7640a explicitly commissions this painted-cell assertion (#7640).
  // oxlint-disable-next-line anti-slop/no-new-web-assertions
  expect(misses(result)).toEqual([]);

  await browser("mouse", "move", String(Math.round(result.box.x + 40)), String(Math.round(result.box.y + 60)));
  await browser("click", ".pane-screen .xterm-screen");

  const after = await paintedCells(result.selector, LINES);
  const kept = after.rows.flatMap((row, index) => row.flatMap(({ bg }, col) => near(bg, after.selection.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3")) ? [`row ${index} col ${col}`] : []));

  // oxlint-disable-next-line anti-slop/no-new-web-assertions
  expect(kept).toEqual([]);
}, 90_000);

it.each([
  ["agent", "dom"], ["agent", "webgl"], ["door", "dom"], ["door", "webgl"], ["bubble", "dom"], ["bubble", "webgl"],
] as const)("u7640b_each_placement_and_renderer_paints_the_same_%s_%s", async (where, renderer) => {
  for (const active of [true, false]) {
    // U7640b reuses U7640a's painted-cell assertion in each placement and renderer.
    // oxlint-disable-next-line anti-slop/no-new-web-assertions
    expect(misses(await render(where, renderer, active))).toEqual([]);
  }
}, 120_000);
