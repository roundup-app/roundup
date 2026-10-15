import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { CHECK_IDS, runChecks } from "./checks";
import { withStylesheets } from "./contrast";
import { chromePath, openPage } from "./chromePage";
import type { Checks } from "./checks";
import { seedApp } from "./seeds";

afterEach(() => {
  cleanup();
  document.querySelectorAll("style[data-u137]").forEach((sheet) => sheet.remove());
});

const mountSeed = () => {
  const controls = seedApp("agents-10", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} />);
};

const addSheet = (css: string) => {
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.dataset.u137 = "";
  sheet.textContent = css;
};

describe("u137 one module measures the checks", () => {
  it("u137_styles_and_rules_have_one_observation_per_check_call_under_processing_cost", async () => {
    await withStylesheets(async () => {
      mountSeed();
      await screen.findAllByRole("treeitem");
      const expected = runChecks();
      const original = window.getComputedStyle.bind(window);
      const reads = new Map<Element, number>();
      const sheets = vi.spyOn(document, "styleSheets", "get");

      const read = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
        reads.set(el, (reads.get(el) ?? 0) + 1);
        const result = original(el, pseudo);

        for (let work = 1; work < 8; work++) original(el, pseudo);

        return result;
      });

      try {
        expect(runChecks()).toEqual(expected);
        expect(sheets).toHaveBeenCalledTimes(1);
        expect(reads.size).toBeGreaterThan(100);
        expect([...reads.values()]).toEqual(Array(reads.size).fill(1));
      } finally {
        read.mockRestore();
        sheets.mockRestore();
      }
    });
  });

  it("u137_a_later_check_call_observes_changed_styles", () => {
    document.body.innerHTML = "<p class='rail-row'>x</p>";
    addSheet(".rail-row { transition-duration: 0s; }");
    expect(runChecks().D9).toEqual({ status: "pass", value: [], selector: "" });

    addSheet(".rail-row { transition-duration: 9s; }");
    expect(runChecks().D9).toEqual({ status: "fail", value: { duration: 9, reduced: false }, selector: "p.rail-row" });

    document.querySelector<HTMLElement>(".rail-row")!.style.transitionDuration = "0s";
    expect(runChecks().D9).toEqual({ status: "pass", value: [], selector: "" });
  });

  it("u137_a_later_check_call_observes_new_interaction_rules", () => {
    document.head.querySelectorAll("style").forEach((sheet) => sheet.remove());
    document.body.innerHTML = '<button class="rail-row" style="height:24px;cursor:pointer">x</button>';
    const before = runChecks();

    expect(before.D6).toMatchObject({ status: "fail", value: { missing: "hover" } });
    expect(before.D7).toMatchObject({ status: "fail", value: { pressed: 0 } });

    addSheet(".rail-row:hover { color: red; } .rail-row:focus-visible { outline: 1px solid; } .rail-row:active { color: blue; transition-duration: 0s; }");
    const after = runChecks();

    expect(after.D6.status).toBe("pass");
    expect(after.D7.status).toBe("pass");
  });

  it("u137_every_id_d1_to_d10_is_present_with_status_value_and_selector", async () => {
    await withStylesheets(async () => {
      mountSeed();
      const checks = runChecks();

      expect(Object.keys(checks)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D16"]);
      expect(CHECK_IDS).toEqual(Object.keys(checks));

      for (const check of Object.values(checks)) {
        expect(["pass", "fail"]).toContain(check.status);
        expect(check).toHaveProperty("value");
        expect(check.selector).toEqual(expect.any(String));
      }
    });
  });

  it("u137_a_stylesheet_with_a_literal_colour_makes_d1_fail", () => {
    document.head.querySelectorAll("style").forEach((sheet) => sheet.remove());
    document.body.innerHTML = "<p class='rail-row'>x</p>";
    addSheet(".rail-row { color: #ff00ff; }");

    const d1 = runChecks().D1;

    expect(d1.status).toBe("fail");
    expect(d1.value).toEqual(["color: rgb(255, 0, 255)"]);
    expect(d1.selector).toBe(".rail-row");
  });

  it("u136_d1_exempts_terminal_rules_and_still_catches_others", () => {
    document.head.querySelectorAll("style").forEach((sheet) => sheet.remove());
    document.body.innerHTML = "<p class='rail-row'>x</p>";
    addSheet(".xterm .composition-view, .xterm .x { color: #ffffff; transition: opacity 100ms linear; }");

    expect(runChecks().D1.status).toBe("pass");

    addSheet(".rail-row, .xterm .x { color: #ff00ff; }");

    expect(runChecks().D1.status).toBe("fail");

    for (const selector of [".pane:has(.xterm) .rail-row", "p:not(.xterm)", ".xterm ~ .rail-row", "p:not(.xterm, .xterm)", ".rail-row[title='.xterm']"]) {
      document.head.querySelectorAll("style").forEach((sheet) => sheet.remove());
      document.body.innerHTML = "<p class='rail-row' title='.xterm'>x</p>";
      addSheet(`${selector} { color: #ff00ff; }`);

      expect(runChecks().D1.status, selector).toBe("fail");
    }
  });

  it("u137_an_inline_literal_colour_makes_d1_fail", () => {
    document.body.innerHTML = `<p style="color: #ff00ff">x</p>`;
    addSheet("p { margin: 0; }");

    expect(runChecks().D1.status).toBe("fail");
  });

  it("u137_a_check_it_cannot_measure_fails_as_not_measurable", () => {
    document.body.innerHTML = "";

    const checks = runChecks();

    for (const id of ["D1", "D2", "D3", "D5", "D6", "D8", "D9"] as const) {
      expect(checks[id].status).toBe("fail");
      expect(checks[id].value).toBe("not measurable");
    }

    expect(checks.D10).toMatchObject({ status: "fail", value: { failing: expect.arrayContaining(["D5"]) } });
  });

  it("u137_the_result_parses_under_the_checks_json_shape_delta_reads", async () => {
    await withStylesheets(async () => {
      mountSeed();
      // SAFETY: the test reads each entry as the `checks.json` shape and asserts it below.
      const parsed = JSON.parse(JSON.stringify(runChecks())) as Record<string, { status: string; value: unknown; selector: string }>;

      for (const id of CHECK_IDS) {
        const entry = parsed[id]!;

        expect(["pass", "fail"]).toContain(entry.status);
        expect(entry.value).not.toBeUndefined();
      }
    });
  });

  it("u137_reading_the_page_changes_nothing_the_user_sees", async () => {
    await withStylesheets(async () => {
      mountSeed();
      const row = (await screen.findAllByRole("treeitem"))[0]!;
      row.focus();
      const before = [document.body.innerHTML, document.head.innerHTML, String(document.activeElement === row)];

      runChecks();

      expect([document.body.innerHTML, document.head.innerHTML, String(document.activeElement === row)]).toEqual(before);
    });
  });
});

const chrome = chromePath();

const rendered = chrome || process.env.CI ? describe : describe.skip;

rendered("u137 rendered composer focus", () => {
  let page: Awaited<ReturnType<typeof openPage>>;

  beforeAll(async () => {
    if (!chrome) throw new Error("U137 requires Chromium");

    page = await openPage(chrome);
  }, 90_000);

  afterAll(async () => { await page?.close(); });

  for (const width of [1280, 1440]) {
    it(`u137_measures_the_visible_composer_mark_after_takeover_release_at_${width}`, async () => {
      await page.load("/harness.html?seed=thread-report", width, 800);
      await page.until(`() => Boolean(document.querySelector('[data-thread-input]'))`);
      await page.press("1", "Digit1", 1);
      await page.until(`() => Boolean(document.querySelector('.pane-takeover'))`);
      await page.press("0", "Digit0", 1);
      await page.until(`() => document.activeElement?.matches('[data-thread-input]') && !document.querySelector('.pane-takeover')`);
      // A zero-width outline matching the ground must not veto the visible blue bar.
      await page.call(`() => { document.activeElement.style.outlineColor = "var(--sunken)"; }`);
      const checks = await page.call<Checks>(`() => window.__checks()`);
      expect(checks.D5).toMatchObject({ status: "pass" });
      expect(checks.D10.status).toBe("pass");
    }, 60_000);
  }

  it("u137_a_low_contrast_visible_mark_fails_despite_a_zero_width_outline", async () => {
    await page.load("/harness.html?seed=thread-report", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('[data-thread-input]'))`);
    await page.call(`() => { document.querySelector('[data-thread-input]').focus(); const sheet = document.createElement('style'); sheet.textContent = '.thread-composer:has(textarea:focus-visible) { background-image: linear-gradient(rgb(220, 220, 220), rgb(220, 220, 220)); }'; document.head.append(sheet); }`);
    const checks = await page.call<Checks>(`() => window.__checks()`);
    expect(checks.D5).toMatchObject({ status: "fail", value: { focusRing: expect.closeTo(1.2594, 3) } });
    expect(checks.D10).toMatchObject({ status: "fail", value: { failing: expect.arrayContaining(["D5"]) } });
  });

  for (const [name, size, expected] of [["a_full_size_wash_is_part_of_the_ground", "100% 100%", { text: 1 }], ["unsupported_localized_coverage_is_not_measurable", "50% 50%", { text: "not measurable" }]] as const) {
    it(`u137_${name}`, async () => {
      await page.load("/harness.html?seed=thread-report", 1280, 800);
      await page.until(`() => Boolean(window.__checks)`);
      await page.call(`(size) => { document.body.innerHTML = '<p>Visible text</p>'; document.body.style.cssText = 'background:white'; const p=document.querySelector('p'); p.style.cssText = 'color:black; background-image:linear-gradient(rgb(0,0,0),rgb(0,0,0)); background-size:' + size; }`, size);
      const checks = await page.call<Checks>(`() => window.__checks()`);
      expect(checks.D5).toMatchObject({ status: "fail", value: expected });
      expect(checks.D10).toMatchObject({ status: "fail", value: { failing: expect.arrayContaining(["D5"]) } });
    });
  }
});
