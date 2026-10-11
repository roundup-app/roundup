import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import tokenStyles from "../tokens.css?inline";
import appStyles from "../styles.css?inline";
import stripStyles from "./strip.styles.css?inline";
import buttonStyles from "../buttons.css?inline";
import { App } from "../App";
import { colourOf, contrastRatio, loadTokens, resolveToken } from "../testing/contrast";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { header, openTabs, path, tab, projectTablist, projectTabs } from "./stripFixture";

afterEach(cleanup);

const withStrip = async <T,>(run: () => Promise<T>): Promise<T> => {
  const sheet = document.head.appendChild(document.createElement("style"));

  sheet.textContent = `${tokenStyles}\n${appStyles}\n${stripStyles}\n${buttonStyles}`;

  try {
    return await run();
  } finally {
    sheet.remove();
  }
};

describe("u179 the header is the strip", () => {
  it("u179_one_tab_per_project_in_the_order_they_were_opened", async () => {
    await openTabs({ api: [], web: [], docs: [] });

    expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "web", "docs"]);
  });

  it("u179_the_header_holds_no_roundup_text_and_no_text_outside_the_strip", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    expect(header().textContent).toBe("api●web+");
    expect(header().textContent).not.toContain("roundup");
  });

  it("u179_the_plus_is_grey_and_chooses_a_folder_then_opens_it_as_the_last_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.chooser.path = path("docs");
    fireEvent.click(screen.getByRole("button", { name: "open a folder" }));

    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "web", "docs"]));
    expect(screen.getByRole("button", { name: "open a folder" }).classList.contains("word")).toBe(true);
  });

  it("u179_the_open_tab_is_in_full_ink_and_the_others_are_grey", async () => {
    await withStrip(async () => {
      await openTabs({ api: [], web: [] });
      const { tokens, ground } = loadTokens();

      expect(colourOf(tab("web"), tokens)).toBe(resolveToken("var(--text)", tokens));
      expect(colourOf(tab("api"), tokens)).toBe(resolveToken("var(--grey)", tokens));
      expect(contrastRatio(colourOf(tab("api"), tokens), ground)).toBeGreaterThanOrEqual(4.5);

      fireEvent.click(tab("api"));

      expect(colourOf(tab("api"), tokens)).toBe(resolveToken("var(--text)", tokens));
      expect(colourOf(tab("web"), tokens)).toBe(resolveToken("var(--grey)", tokens));
    });
  });

  it("u179_a_tab_has_no_border_background_or_underline", async () => {
    await withStrip(async () => {
      await openTabs({ api: [agent("a", "error", "x")], web: [] });

      for (const element of [...projectTabs(), ...document.querySelectorAll(".project-tab, .tab-mark")]) {
        const style = getComputedStyle(element);

        expect(["", "0", "0px"]).toContain(style.borderTopWidth);
        expect(["", "transparent", "rgba(0, 0, 0, 0)", "var(--button-surface)"]).toContain(style.backgroundColor);
        expect(["", "none"]).toContain(style.textDecorationLine);
      }
    });
  });

  it("u179_the_roles_and_the_marks_text_label", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "error", "x")] });

    const list = projectTablist();

    expect(within(list).getAllByRole("tab")).toHaveLength(2);
    expect(tab("web").getAttribute("aria-selected")).toBe("true");
    expect(tab("api").getAttribute("aria-selected")).toBe("false");
    expect(within(tab("api")).getByRole("img").getAttribute("aria-label")).toBe("needs you");
    expect(within(tab("web")).getByRole("img").getAttribute("aria-label")).toBe("error");
  });

  it("u179_a_tab_shows_nothing_else_until_hover", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(tab("api").textContent).toBe("api●");
    expect(document.querySelector(".tab-close")?.getAttribute("data-visible")).toBe("false");
  });

  it("u179_the_first_run_header_is_the_plus_alone", async () => {
    render(() => <App app={createFakeApp()} reducedMotion={() => false} clock={() => 0} />);

    await screen.findByText("open a folder to start");

    expect(header().textContent).toBe("+");
    expect((projectTabs()[0] ?? null)).toBeNull();
  });
});
