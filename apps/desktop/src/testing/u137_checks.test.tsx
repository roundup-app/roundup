import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { CHECK_IDS, runChecks } from "./checks";
import { withStylesheets } from "./contrast";
import { chromePath, openPage, FULLSCREEN } from "./chromePage";
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
  it("u137_editor_menu_is_not_an_item_row", () => {
    document.body.innerHTML = '<aside><ul><li data-id="pad"><span class="glyph"></span>Pad</li></ul><div class="milkdown-slash-menu"><nav class="tab-group"><ul><li class="selected">Text</li><li>List</li><li>Advanced</li></ul></nav><div class="menu-groups"><ul><li data-index="0">Paragraph</li></ul></div></div></aside>';
    const before = document.body.innerHTML;
    expect(runChecks().D4.status).toBe("pass");
    expect(document.body.innerHTML).toBe(before);

    document.querySelector<HTMLElement>(".milkdown-slash-menu li")!.style.color = "#ff00ff";
    expect(runChecks().D1.status).toBe("fail");
    document.querySelector(".glyph")!.remove();
    expect(runChecks().D4).toMatchObject({ status: "fail", selector: 'li[data-id="pad"]' });
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

    expect(checks.D10.status).toBe("fail");
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

describe("u131 D2 KeyChip spacing", () => {
  it.each([
    ["kbd", "", "padding-left: 5px"],
    ["span", "key-chip", "padding-left: 5px"],
    ...["margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "row-gap", "column-gap"].map((property) => ["p", "", `${property}: 5px`]),
    ...["margin-top", "margin-right", "margin-bottom", "margin-left", "row-gap", "column-gap"].map((property) => ["kbd", "key-chip", `padding-top: 0; padding-right: var(--key-chip-padding); padding-bottom: 0; padding-left: var(--key-chip-padding); ${property}: 5px`]),
    ...["padding-left: 4px", "padding-right: 8px", "padding-top: 4px", "padding-bottom: 5px", "padding-left: 6px"].map((padding) => ["kbd", "key-chip", `padding-top: 0; padding-right: var(--key-chip-padding); padding-bottom: 0; padding-left: var(--key-chip-padding); ${padding}`]),
  ])("u131_rejects_nonconforming_spacing_on_%s_%s_%s", (tag, className, spacing) => {
    document.body.innerHTML = `<${tag} class="${className}">x</${tag}>`;
    addSheet(`:root { --key-chip-padding: 5px; } ${tag} { font-size: 13px; ${spacing}; }`);

    expect(runChecks().D2.status).toBe("fail");
  });

  it.each(["", "--key-chip-padding: 6px;"])("u131_requires_the_specified_chip_token_%s", (token) => {
    document.body.innerHTML = '<kbd class="key-chip">⌘</kbd>';
    addSheet(`:root { ${token} } .key-chip { font-size: 13px; padding: 0 5px; }`);

    expect(runChecks().D2.status).toBe("fail");
  });

  it("u131_accepts_the_u2541_key_chip_side_padding_token", () => {
    document.body.innerHTML = '<kbd class="key-chip">⌘</kbd>';
    addSheet(":root { --key-chip-padding: 5px; } .key-chip { font-size: 13px; padding-top: 0; padding-right: var(--key-chip-padding); padding-bottom: 0; padding-left: var(--key-chip-padding); }");

    expect(runChecks().D2).toEqual({ status: "pass", value: [], selector: "" });
  });
});

const chrome = chromePath();

const rendered = chrome || process.env.CI ? describe : describe.skip;

rendered("u137 rendered focus marks", () => {
  let page: Awaited<ReturnType<typeof openPage>>;

  // The first load compiles the harness bundle; do it here so no test's 5 s budget pays for it.
  beforeAll(async () => {
    if (!chrome) throw new Error("U137 requires Chromium");

    page = await openPage(chrome);
    await page.load("/harness.html?seed=door-report", 1280, 800);
  }, 90_000);
  afterAll(async () => { await page?.close(); });

  it("u137_floating_menu_shadow_keeps_unrelated_shadow_rejection", async () => {
    for (const scheme of ["light", "dark"] as const) {
      await page.scheme(scheme);
      await page.load("/harness.html?seed=tree-40");

      const observed = await page.call<string[]>(`() => {
        document.body.innerHTML = '<div class="milkdown-slash-menu" style="box-shadow:var(--shadow-drawer)"><p>Text</p></div><p class="content">Content</p>';
        const statuses = [window.__checks().D8.status];
        document.querySelector('.content').style.boxShadow = 'var(--shadow-drawer)';
        statuses.push(window.__checks().D8.status);
        document.querySelector('.content').style.boxShadow = 'none';
        document.querySelector('.milkdown-slash-menu p').style.boxShadow = '0 2px 5px red';
        statuses.push(window.__checks().D8.status);
        document.querySelector('.milkdown-slash-menu p').style.boxShadow = 'none';
        document.querySelector('.milkdown-slash-menu').style.boxShadow = '0 2px 5px red';
        statuses.push(window.__checks().D8.status);
        return statuses;
      }`);

      expect(observed, scheme).toEqual(["pass", "fail", "fail", "fail"]);
    }
  }, 60_000);

  for (const field of ["title", "ask"]) {
    for (const lowContrast of [false, true]) {
      it(`u137_measures_the_order_${field}_focus_mark_${lowContrast ? "below" : "above"}_three_to_one`, async () => {
        await page.load("/harness.html?seed=door-report", 1280, 800);
        await page.call(`() => document.querySelector('[data-id="c1"] .name').click()`);
        await page.until(`() => Boolean(document.querySelector('.order-line'))`);
        await page.call(`() => document.querySelector('.order-line').click()`);
        await page.until(`() => Boolean(document.querySelector('[aria-label="Edit order"]'))`);
        await page.call(`() => document.querySelector('[aria-label="Edit order"]').click()`);
        await page.until(`() => Boolean(document.querySelector('textarea[name="${field}"]'))`);
        await page.call(`(field, lowContrast) => {
          const input = document.querySelector('textarea[name="' + field + '"]');
          input.focus();
          if (lowContrast) input.style.backgroundImage = 'linear-gradient(var(--ground), var(--ground))';
        }`, field, lowContrast);
        const checks = await page.call<Checks>(`() => window.__checks()`);

        expect(checks.D5).toMatchObject(lowContrast
          ? { status: "fail", value: { focusRing: 1 } }
          : { status: "pass" });
      });
    }
  }

  it("u137_measures_a_percentage_width_focus_mark_on_an_unnamed_container", async () => {
    await page.load("/harness.html?seed=door-report", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);
    await page.call(`() => {
      document.body.innerHTML = '<div style="width: 240px; height: 80px; background-color: white; background-image: linear-gradient(white, white); background-size: 1% 100%; background-repeat: no-repeat; background-position: left"><textarea style="color: black; background: transparent; outline-width: 0">text</textarea></div>';
      document.querySelector('textarea').focus();
    }`);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(checks.D5).toMatchObject({ status: "fail", value: { focusRing: 1 } });
  });

  it("u137_a_full_size_uniform_wash_remains_part_of_the_text_ground", async () => {
    await page.load("/harness.html?seed=door-report", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);
    await page.call(`() => { document.body.innerHTML = '<p style="color: white; background-color: black; background-image: linear-gradient(white, white); background-size: 100% 100%">text</p>'; }`);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(checks.D5).toMatchObject({ status: "fail", value: { text: 1 } });
  });

  it("u137_unsupported_single_layer_coverage_is_not_measurable", async () => {
    await page.load("/harness.html?seed=door-report", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);
    await page.call(`() => { document.body.innerHTML = '<p style="color: white; background-color: black; background-image: linear-gradient(white, white); background-size: 50% 50%; background-repeat: no-repeat">text</p>'; }`);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(checks.D5).toMatchObject({ status: "fail", value: "not measurable" });
    expect(checks.D10.status).toBe("fail");
  });
});

rendered("U135 U136 U161 painted scheme checks", () => {
  let page: Awaited<ReturnType<typeof openPage>>;

  beforeAll(async () => { if (!chrome) throw new Error("Scheme checks require Chromium"); page = await openPage(chrome); }, 90_000);
  afterAll(async () => { await page?.close(); });

  const load = async (seed: string, width = 1280, height = 800) => {
    await page.load(`/harness.html?seed=${seed}`, width, height);
    await page.until(`() => Boolean(window.__fake) && Boolean(document.querySelector('[role="tree"]'))`);

    if (seed === "daemon-exits") await page.until(`() => [...document.querySelectorAll('button')].some(el => el.textContent === 'Reopen')`);

    if (seed === "door-stopped") await page.until(`() => document.body.textContent.includes('Supervisor stopped, exited 0')`);
  };

  for (const [name, scheme, contrast, reduced] of [
    ["more-contrast", "light", "more"],
    ["dark_more-contrast", "dark", "more"], ["reduced-transparency", "light", undefined, "transparency"],
    ["reduced-motion", "light", undefined, "motion"],
  ] as const) {
    it(`u135_${name}_d5_on_painted_layout_at_1280_by_800`, async () => {
      await page.scheme(scheme, contrast, reduced);
      await load("agents-10");

      if (contrast) expect(await page.call<boolean>(`() => matchMedia('(prefers-contrast: more)').matches`)).toBe(true);

      if (reduced) expect(await page.call<boolean>(`(feature) => matchMedia('(prefers-reduced-' + feature + ': reduce)').matches`, reduced)).toBe(true);

      const checks = await page.call<Checks>(`() => window.__checks()`);

      expect(checks.D5, JSON.stringify(checks.D5)).toMatchObject({ status: "pass" });
    }, 60_000);
  }

  for (const scheme of ["light", "dark"] as const) for (const contrast of [undefined, "more"] as const) {
    it(`u131_accepts_token_backed_chip_padding_in_${scheme}_${contrast ?? "normal"}`, async () => {
      await page.scheme(scheme, contrast);
      await load("agents-10");
      await page.call(`() => {
        const tokens = document.head.appendChild(document.createElement('style'));
        tokens.dataset.viteDevId = '/src/tokens.css';
        tokens.textContent = ':root { --key-chip-padding: 5px; }';
        const sheet = document.head.appendChild(document.createElement('style'));
        sheet.textContent = 'kbd.key-chip { padding-top: 0; padding-right: var(--key-chip-padding); padding-bottom: 0; padding-left: var(--key-chip-padding); font-size: var(--text-small); font-family: var(--font-ui); }';
        const chip = document.createElement('kbd');
        chip.className = 'key-chip';
        chip.textContent = '⌘';
        document.querySelector('.pane-screen').appendChild(chip);
      }`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of CHECK_IDS) expect(checks[id], `${id}: ${JSON.stringify(checks[id])}`).toMatchObject({ status: "pass" });
    }, 60_000);
  }

  it("u135_d10_holds_at_1280_by_800", async () => {
    await page.scheme("dark");
    await load("door-stopped");
    await page.until(`() => Boolean(document.querySelector('[role="treeitem"][aria-selected="true"]'))`);
    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(checks.D10.value).toMatchObject({ viewport: "1280x800", scheme: "dark" });
    expect(checks.D10, JSON.stringify(checks.D10)).toMatchObject({ status: "pass" });
  }, 60_000);

  for (const seed of ["daemon-exits", "conflict"]) for (const scheme of ["light", "dark"] as const) for (const [width, height] of [[1280, 800], [1440, 800]] as const) {
    it(`u136_${seed.replace("-", "_")}_${scheme}_d5_d10_on_painted_layout_at_${width}_by_${height}`, async () => {
      await page.scheme(scheme);
      await load(seed, width, height);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D5", "D10"] as const) expect(checks[id], JSON.stringify(checks[id])).toMatchObject({ status: "pass" });
    }, 60_000);
  }

  for (const scheme of ["light", "dark"] as const) for (const width of [FULLSCREEN.width]) {
    it(`u161_checks_${scheme}_d5_on_painted_layout_at_${width}_by_800`, async () => {
      await page.scheme(scheme);
      await load("door-stopped", width);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      expect(checks.D5, JSON.stringify(checks.D5)).toMatchObject({ status: "pass" });
    }, 60_000);
  }
});
