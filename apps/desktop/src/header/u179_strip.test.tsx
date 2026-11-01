import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { header, openTabs, path, tab, projectTablist, projectTabs } from "./stripFixture";

afterEach(cleanup);

describe("u179 the header is the strip", () => {
  it("u179_one_tab_per_project_in_the_order_they_were_opened", async () => {
    await openTabs({ api: [], web: [], docs: [] });

    expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "web", "docs"]);
  });

  it("u449_the_header_keeps_the_strip_and_project_title", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });


    expect(projectTabs().map(entry => entry.textContent)).toEqual(["api", "web"]);
  });

  it("u179_the_plus_is_grey_and_chooses_a_folder_then_opens_it_as_the_last_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    app.chooser.path = path("docs");
    fireEvent.click(screen.getByRole("button", { name: "Open Project" }));

    await waitFor(() => expect(projectTabs().map((entry) => entry.textContent)).toEqual(["api", "web", "docs"]));
    expect(screen.getByRole("button", { name: "Open Project" }).classList.contains("word")).toBe(true);
  });

  it("u179_the_roles_and_the_marks_text_label", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [agent("b", "error", "x")] });

    const list = projectTablist();

    expect(within(list).getAllByRole("tab")).toHaveLength(2);
    expect(tab("web").getAttribute("aria-selected")).toBe("true");
    expect(tab("api").getAttribute("aria-selected")).toBe("false");
    expect(within(tab("api")).getByRole("img").getAttribute("aria-label")).toBe("Needs you");
    expect(within(tab("web")).queryByRole("img")).toBeNull();
  });

  it("u179_a_tab_shows_nothing_else_until_hover", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(tab("api").textContent).toBe("api");
    expect(document.querySelector(".tab-close")?.getAttribute("data-visible")).toBe("false");
  });


});
