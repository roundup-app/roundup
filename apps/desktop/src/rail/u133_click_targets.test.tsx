import { showShelfTab } from "../testing/shelfTabs";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { contrastRatio, resolveToken, tokensFrom } from "../testing/contrast";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import buttonsCss from "../buttons.css?inline";
import "./styles.css";

const tokens = tokensFrom(tokenCss);

// main.tsx loads these two; the test mounts the App without it.
const shell = (() => {
  const sheet = document.createElement("style");
  sheet.textContent = `${tokenCss}\n${appCss}\n${buttonsCss}`;

  return sheet;
})();

afterEach(() => {
  shell.remove();
  cleanup();
});

const mount = async (seed: "tree-40" | "daemon-exits") => {
  document.head.prepend(shell);
  const controls = seedApp(seed, Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await found(() => document.querySelector("[role=treeitem]"));

  return controls;
};

// ItemDrawer publishes this control only after provenance.history and pad.read answer.
// A document-wide role query scans unrelated buttons while those reads are pending.
const exportButton = () => found(() => document.querySelector<HTMLButtonElement>('[aria-label="Drawer"] button[aria-label="Export .md"]'));

/** Waits for `look` to find an element; a role query would walk the whole accessibility tree, which costs far more than the clause under test. */
const found = <T extends Element>(look: () => T | null | undefined): Promise<T> =>
  waitFor(() => {
    const element = look();

    if (!element) throw new Error("not rendered yet");

    return element;
  });

describe("u133 click targets", () => {
  it("u133_the_ring_is_3_to_1_against_the_ground_and_the_sunken_surface", () => {
    for (const ground of ["ground", "sunken"]) expect(contrastRatio(resolveToken("var(--accent)", tokens), resolveToken(`var(--${ground})`, tokens))).toBeGreaterThanOrEqual(3);
  });

  it("u133_export_md_is_a_button", async () => {
    await mount("tree-40");
    showShelfTab("Pads");
    fireEvent.click(await found(() => document.querySelector<HTMLElement>(".shelf .pad-name")));
    const exportMd = await exportButton();
    const drawer = await found(() => document.querySelector<HTMLElement>('[aria-label="Drawer"]'));

    expect(exportMd.tagName).toBe("BUTTON");
    expect(within(drawer).getByRole("button", { name: "Export .md" })).toBe(exportMd);
  });

  it("u133_a_disabled_button_is_aria_disabled_and_not_disabled", async () => {
    const controls = await mount("daemon-exits");
    controls.app.exitDaemon({ code: 1 });
    await waitFor(() => expect(document.querySelectorAll('button[aria-disabled="true"]').length).toBeGreaterThan(0));

    for (const el of document.querySelectorAll('button[aria-disabled="true"]')) expect(el.hasAttribute("disabled"), el.textContent ?? "").toBe(false);
  });
});
