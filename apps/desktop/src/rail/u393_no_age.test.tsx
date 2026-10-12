import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, rowOf } from "./railFixture";
import { agent, MINUTE, NOW } from "../testing/nodes";
import styles from "./styles.css?inline";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";

afterEach(cleanup);

const asking = () =>
  agent("gateway", "needs-you", "asks: keep v1 routes?", {
    status: { kind: "needs-you", label: "asks: keep v1 routes?", since: NOW - 4 * MINUTE },
  });

const part = (cls: string) => rowOf("gateway").querySelector(`.live .${cls}`);

describe("u393 the Live line is the Status label alone", () => {
  it("u393_live_line_is_the_label", async () => {
    await mountRail([asking()]);
    const live = rowOf("gateway").querySelector(".live");

    expect([live?.textContent, live?.getAttribute("title"), part("live-age")]).toEqual(["asks: keep v1 routes?", "asks: keep v1 routes?", null]);
  });

  it("u393_no_age_after_the_clock_advances", async () => {
    const { setNow } = await mountRail([asking()]);

    setNow(NOW + 5 * MINUTE);

    expect(rowOf("gateway").textContent).not.toMatch(/just now|\dm\b/);
  });

  it("u7_only_the_label_shrinks_and_gets_the_ellipsis", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([asking()]);

    const label = getComputedStyle(part("live-label")!);

    sheet.remove();

    expect([label.flexShrink, label.minWidth, label.overflow, label.textOverflow]).toEqual(["1", "0px", "hidden", "ellipsis"]);
  });
});

const sources = import.meta.glob<string>("../**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true });

const mountSeed = async (seed: SeedName) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  render(() => <App app={seedApp(seed, Date.now()).app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");

  return screen.getAllByRole("treeitem");
};

describe("u393 a Rail row shows neither an age nor a count", () => {
  it.each(["agents-10", "thread-report"] as const)("u393_no_age_in_any_row (%s)", async (seed) => {
    const rows = await mountSeed(seed);

    expect(rows.flatMap((row) => [...row.querySelectorAll(".live-age")])).toEqual([]);
    expect(rows.filter((row) => /just now|\b\d+[mhd]\b/.test(row.textContent ?? "")).map((row) => row.textContent)).toEqual([]);
  });

  it.each(["agents-10", "tree-40", "thread-report"] as const)("u393_no_count_on_a_workstream_row (%s)", async (seed) => {
    const rows = (await mountSeed(seed)).filter((row) => row.hasAttribute("aria-expanded"));

    expect(document.querySelector(".value")).toBeNull();
    expect(rows.filter((row) => /^\d+$/.test(row.lastElementChild?.textContent?.trim() ?? ""))).toEqual([]);
  });

  it("u393_row_height_unmoved", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    const rows = await mountSeed("agents-10");
    const heights = () => rows.map((row) => getComputedStyle(row).height);
    const before = heights();

    rows.forEach((row) => fireEvent.pointerEnter(row));
    rows.forEach((row) => fireEvent.mouseOver(row));
    const after = heights();

    sheet.remove();

    expect(after).toEqual(before);
  });

  it("u393_no_dead_code", () => {
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const own = Object.entries(sources).filter(([path]) => !path.includes("u393_"));
    const found = own.flatMap(([path, text]) => [/\belapsed\b|\bliveAgentsBelow\b|\bagentsLive\b|\blive-age\b/, /\.value\s*[{,]/].flatMap((re, i) => (i === 1 && !path.endsWith(".css") ? [] : !path.endsWith(".test.ts") && !path.endsWith(".test.tsx") && re.test(code(text)) ? [path] : [])));

    expect(found).toEqual([]);
  });
});
