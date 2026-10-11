import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** The clauses of U368 to U372 that need a real cascade, real boxes or real keys: styles, order, edges and widths read in Chromium. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U373 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async (width = 1280, height = 820, scheme: "light" | "dark" = "light") => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(window.__fake) && document.querySelector(".shelf") !== null && document.querySelector('.shelf [role="tab"]') !== null`);
  await page.until(`() => { const left = document.querySelector(".shelf").getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return same && left < window.innerWidth; }`);
  // Token values as the page resolves them: a probe element takes the property from `var(--name)`.
  await page.call(`() => {
    window.__token = (name, property) => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style[property] = "var(" + name + ")";
      const value = getComputedStyle(probe)[property];
      probe.remove();
      return value;
    };
  }`);
};

const selectWorkstream = `async () => {
  document.querySelector('[data-id="backend"]').click();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}`;

run("u373 the tabs", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u373_the_open_tab_is_text_the_other_grey_with_no_chrome_and_a_caption_count", async () => {
    await load();
    await page.until(`() => document.querySelector(".shelf-count") !== null`);

    const read = await page.call<Record<string, string>[]>(`() => [...document.querySelectorAll('.shelf [role="tab"]')].map((tab) => {
      const style = getComputedStyle(tab);
      const count = tab.querySelector(".shelf-count");
      const counted = count ? getComputedStyle(count) : null;
      return {
        selected: tab.getAttribute("aria-selected"),
        color: style.color,
        background: style.backgroundColor,
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join(" "),
        line: style.textDecorationLine,
        shadow: style.boxShadow,
        countColor: counted?.color ?? "",
        countSize: counted?.fontSize ?? "",
      };
    })`);

    const [text, grey, caption] = await page.call<string[]>(`() => [window.__token("--text", "color"), window.__token("--grey", "color"), window.__token("--text-caption", "fontSize")]`);

    expect(read.map((tab) => tab["selected"])).toEqual(["true", "false"]);
    expect(read[0]!["color"]).toBe(text);
    expect(read[1]!["color"]).toBe(grey);

    for (const tab of read) {
      expect(tab["background"]).toBe("rgba(0, 0, 0, 0)");
      expect(tab["borders"]).toBe("0px 0px 0px 0px");
      expect(tab["line"]).toBe("none");
      expect(tab["shadow"]).toBe("none");
    }

    expect(read[0]!["countColor"]).toBe(grey);
    expect(read[0]!["countSize"]).toBe(caption);
  });

  it("u373_the_tabs_come_before_the_list_in_the_tab_order", async () => {
    await load();

    const order = await page.call<string[]>(`() => {
      const tabbable = [...document.querySelectorAll(".shelf button, .shelf input, .shelf [tabindex]")].filter((el) => el.tabIndex >= 0);
      return tabbable.map((el) => el.getAttribute("role") === "tab" ? "tab" : el.closest('[role="tabpanel"]') ? "list" : "bar");
    }`);

    expect(order.indexOf("list")).toBeGreaterThan(order.lastIndexOf("tab"));
    expect(order.filter((entry) => entry === "tab")).toHaveLength(1);

    // No positive tabindex reorders the Tab order.
    const positive = await page.call<number>(`() => [...document.querySelectorAll("[tabindex]")].filter((el) => el.tabIndex > 0).length`);

    expect(positive).toBe(0);
  });

  it("u373_a_restored_tab_shows_in_the_first_frame_with_no_animation", async () => {
    await load();
    await page.call(`() => { [...document.querySelectorAll('.shelf [role="tab"]')].find((tab) => tab.textContent.startsWith("Pads")).click(); }`);
    await page.until(`() => document.querySelector('.shelf section[aria-label="pads"]') !== null`);
    await load();

    const read = await page.call<{ selected: string; animations: number; transition: string[] }>(`() => ({
      selected: document.querySelector('.shelf [role="tab"][aria-selected="true"]').textContent,
      animations: document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".shelf-bar, .shelf-panel, .shelf-area")).length,
      transition: [...document.querySelectorAll('.shelf [role="tab"], .shelf [role="tabpanel"]')].map((el) => getComputedStyle(el).transitionDuration),
    })`);

    expect(read.selected).toMatch(/^Pads/);
    expect(read.animations).toBe(0);
    expect(read.transition.every((duration) => duration.split(", ").every((one) => one === "0s"))).toBe(true);
  });
});

run("u368 the scope control", () => {
  it("u368_the_pressed_one_is_text_on_selected_with_the_control_radius_the_other_grey", async () => {
    await load();
    await page.call(selectWorkstream);
    await page.until(`() => document.querySelector('[role="group"][aria-label="show Todos"]') !== null`);

    const read = await page.call<{ pressed: string[]; other: string[]; tokens: string[] }>(`() => {
      const [first, second] = [...document.querySelectorAll('[aria-label="show Todos"] button')];
      const pressed = first.getAttribute("aria-pressed") === "true" ? first : second;
      const other = pressed === first ? second : first;
      const read = (el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.borderTopLeftRadius]; };
      return { pressed: read(pressed), other: read(other), tokens: [window.__token("--text", "color"), window.__token("--selected", "backgroundColor"), window.__token("--radius-control", "borderTopLeftRadius"), window.__token("--grey", "color")] };
    }`);

    expect(read.pressed).toEqual([read.tokens[0], read.tokens[1], read.tokens[2]]);
    expect(read.other[0]).toBe(read.tokens[3]);
    expect(read.other[1]).toBe("rgba(0, 0, 0, 0)");
  });

  it("u368_arrows_move_focus_and_space_and_enter_press_the_focused_one", async () => {
    await load();
    await page.call(selectWorkstream);
    await page.until(`() => document.querySelector('[role="group"][aria-label="show Todos"]') !== null`);

    const state = `() => [...document.querySelectorAll('[aria-label="show Todos"] button')].map((el) => el.getAttribute("aria-pressed") + (document.activeElement === el ? "*" : ""))`;

    // A Workstream selected fresh opens on `this one` (U347); focus `all`, then drive the keys.
    await page.call(`() => document.querySelector('[aria-label="show Todos"] button').focus()`);
    await page.press("ArrowRight", "ArrowRight");
    expect(await page.call<string[]>(state)).toEqual(["false", "true*"]);
    await page.press("ArrowLeft", "ArrowLeft");
    expect(await page.call<string[]>(state)).toEqual(["false*", "true"]);
    await page.press(" ", "Space");
    expect(await page.call<string[]>(state)).toEqual(["true*", "false"]);
    await page.press("ArrowRight", "ArrowRight");
    await page.press("Enter", "Enter");
    expect(await page.call<string[]>(state)).toEqual(["false", "true*"]);
  });
});

run("u369 the Shelf's edges", () => {
  for (const [width, height] of [[1280, 820], [700, 800]] as const) {
    it(`u369_the_shelf_spans_the_window_with_one_leading_hairline at ${width}x${height}`, async () => {
      await load(width, height);

      const read = await page.call<Record<string, number | string>>(`() => {
        const shelf = document.querySelector(".shelf");
        const box = shelf.getBoundingClientRect();
        const style = getComputedStyle(shelf);
        const header = document.querySelector(".header").getBoundingClientRect();
        const bar = document.querySelector(".shelf-bar").getBoundingClientRect();
        return {
          top: box.top, bottom: box.bottom, height: window.innerHeight,
          topBorder: style.borderTopWidth, leftBorder: style.borderLeftWidth, leftColor: style.borderLeftColor, hairline: window.__token("--hairline", "color"),
          barTop: bar.top, barHeight: bar.height, headerHeight: header.height,
        };
      }`);

      expect([read["top"], read["bottom"]]).toEqual([0, read["height"]]);
      expect([read["topBorder"], read["leftBorder"]]).toEqual(["0px", "1px"]);
      expect(read["leftColor"]).toBe(read["hairline"]);
      expect([read["barTop"], read["barHeight"]]).toEqual([0, read["headerHeight"]]);
    });

    it(`u369_the_rail_and_the_pane_do_not_move_when_the_shelf_closes at ${width}x${height}`, async () => {
      await load(width, height);

      const boxes = `() => ["rail", "centre"].map((name) => { const box = document.querySelector("." + name).getBoundingClientRect(); return [box.left, box.top, box.width, box.height]; })`;
      const open = await page.call<number[][]>(boxes);
      const overlaps = await page.call<boolean>(`() => document.querySelector(".shelf").getBoundingClientRect().left < document.querySelector(".centre").getBoundingClientRect().right`);

      await page.call(`() => document.querySelector('[aria-label="hide Shelf"]').click()`);
      await page.until(`() => document.querySelector(".shelf").hidden === true && getComputedStyle(document.querySelector(".shelf")).display === "none"`);

      expect(overlaps).toBe(true);
      expect(await page.call<number[][]>(boxes)).toEqual(open);
    });
  }
});

run("u371 shadows by scheme", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`u371_the_shelf_ground_and_both_shadow_tokens in ${scheme}`, async () => {
      await load(1280, 820, scheme);

      const read = await page.call<string[]>(`() => [
        getComputedStyle(document.querySelector(".shelf")).backgroundColor, window.__token("--sunken", "backgroundColor"),
        getComputedStyle(document.documentElement).getPropertyValue("--shadow-shelf").trim(),
        getComputedStyle(document.documentElement).getPropertyValue("--shadow-scroll").trim(),
      ]`);

      expect(read[0]).toBe(read[1]);
      expect(read[2]).toBe(scheme === "light" ? "0 0 24px rgba(0, 0, 0, 0.1)" : "0 0 24px rgba(0, 0, 0, 0.45)");
      expect(read[3]).toBe(scheme === "light" ? "inset 0 8px 8px -8px rgba(0, 0, 0, 0.18)" : "inset 0 8px 8px -8px rgba(0, 0, 0, 0.6)");
    });
  }
});

run("u372 the worst case in the Shelf", () => {
  for (const [width, height] of [[1280, 820], [700, 800]] as const) {
    it(`u372_no_horizontal_scroll_on_the_worst_case at ${width}x${height}`, async () => {
      await load(width, height);
      await page.call(`async () => {
        const app = window.__fake.app;
        window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
        await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
        const blockers = [];
        for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
        await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
        const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
        const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
        await app.rpc("todo.move", { id: homed.id, home: home.id });
        await app.rpc("pad.create", { name: "p".repeat(120), text: "preview ".repeat(80) });
        await new Promise((done) => setTimeout(done, 400));
      }`);

      const measure = `async (list) => {
        const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
        if (tab.getAttribute("aria-selected") !== "true") tab.click();
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const area = document.querySelector(".shelf-area");
        const widest = Math.max(...[...area.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right));
        return { rows: area.querySelectorAll("[data-todo], [data-pad]").length, scroll: area.scrollWidth, client: area.clientWidth, widest, edge: area.getBoundingClientRect().right, text: area.textContent };
      }`;

      const todos = await page.call<{ rows: number; scroll: number; client: number; widest: number; edge: number; text: string }>(measure, "todos");

      expect(todos.text).toContain("w".repeat(300).slice(0, 40));
      expect(todos.scroll).toBeLessThanOrEqual(todos.client);

      const pads = await page.call<{ rows: number; scroll: number; client: number; widest: number; edge: number; text: string }>(measure, "pads");

      expect(pads.scroll).toBeLessThanOrEqual(pads.client);
      expect(pads.widest).toBeLessThanOrEqual(pads.edge + 1);
      // A Pad's text beyond a row's two lines is not in the Shelf; it is whole in the Pad's Drawer.
      expect(pads.text).not.toContain("preview ".repeat(80).trim());
    });
  }
});
