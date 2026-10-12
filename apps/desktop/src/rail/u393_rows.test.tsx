import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const mountSeed = async (seed: SeedName) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
};

/** Every row in turn is selected, so the Live line of each shows (U7), and `read` sees it. */
const eachRow = <T,>(read: (row: HTMLElement) => T): T[] =>
  screen.getAllByRole("treeitem").map((row, at) => {
    fireEvent.click(row);

    return read(screen.getAllByRole("treeitem")[at]!);
  });

describe("u393 a Rail row shows neither an age nor a count", () => {
  for (const seed of ["agents-10", "thread-report"] as const) {
    it(`u393_no_age_in_any_row on ${seed}`, async () => {
      await mountSeed(seed);

      const rows = eachRow((row) => [row.querySelector(".live-age"), /\b(just now|\d+[mhd])\b/.test(row.textContent ?? ""), row.querySelector(".value")]);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(([age, text, value]) => age === null && text === false && value === null)).toBe(true);
    });
  }

  it("u393_no_count_on_a_workstream_row", async () => {
    await mountSeed("tree-40");

    const workstreams = screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("aria-expanded"));

    expect(workstreams.length).toBeGreaterThan(0);

    for (const row of workstreams) {
      const line = row.querySelector(".line")!;

      expect([row.querySelector(".value"), /^\d+$/.test(line.lastElementChild?.textContent?.trim() ?? "")]).toEqual([null, false]);
    }

    expect(document.querySelectorAll(".value")).toHaveLength(0);
  });

  it("u393_live_line_is_the_label", async () => {
    await mountSeed("agents-10");

    const lines = eachRow((row) => {
      const live = row.querySelector<HTMLElement>(".live");

      return live ? [live.textContent, live.title, row.querySelector(".live-label")?.textContent] : null;
    }).filter((line) => line !== null);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(([text, title, label]) => text === label && title === label && text !== "")).toBe(true);
  });

  it("u393_no_dead_code", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));

    const sources = files(join(process.cwd(), "src")).filter((file) => /\.(tsx?|css)$/.test(file) && !/\/u393_[^/]*$/.test(file));
    const text = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const hits = (pattern: RegExp, only: RegExp) => sources.filter((file) => only.test(file) && pattern.test(text(file)));

    const found = [
      ...["elapsed", "liveAgentsBelow", "agentsLive", "live-age"].flatMap((name) => hits(new RegExp(`\\b${name}\\b`), /./)),
      ...hits(/\.value\b\s*[{,]/, /\.css$/),
    ];

    expect(found).toEqual([]);
  });
});
