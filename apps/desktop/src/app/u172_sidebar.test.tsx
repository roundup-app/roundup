import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { mountTodos, todo } from "../todos/testHarness";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";

const uiCss = Object.values(import.meta.glob<string>("../ui/*.css", { query: "?inline", import: "default", eager: true })).join("\n");

import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

const styled = () => {
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, uiCss, railCss, buttonCss, inkCss, rowCss].join("\n");
};

const mountApp = async (seed: SeedName) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  styled();
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");

  return controls;
};

const workstreams = () => screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("aria-expanded"));

describe("u172 the sidebar's hierarchy", () => {
  it("u403_a_workstream_row_reads_chevron_name_and_no_badge_value_or_head", async () => {
    await mountApp("tree-40");
    const rows = workstreams();

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const parts = [...row.querySelector(".line")!.children];
      const name = row.querySelector(".name")!.textContent!;
      const order = ["rail-chevron", "name"].map((part) => parts.findIndex((el) => el.classList.contains(part)));

      expect(order.every((at) => at >= 0), name).toBe(true);
      expect(order, name).toEqual([...order].sort((a, b) => a - b));
      expect(order[0], name).toBe(0);
      expect(row.querySelector('button[aria-label="Collapse"]')!.getAttribute("data-button")).toBe("icon");
      expect(row.querySelector(".badge, .value"), name).toBeNull();
    }

    expect(document.querySelector("[data-group]")).toBeNull();
  });

  it("u403_the_door_action_takes_the_right_side_and_the_name_gives_way", async () => {
    await mountRail([workstream("g"), agent("a", "working", "w", { parent: "g" })]);

    expect(screen.queryByRole("button", { name: "Start supervisor" })).toBeNull();
    fireEvent.mouseEnter(rowOf("g"));
    expect(screen.getByRole("button", { name: "Start supervisor" }).getAttribute("data-button")).toBe("icon");
    expect(screen.getByRole("button", { name: "Start supervisor" }).querySelector(".icon")).toBeTruthy();
    fireEvent.mouseLeave(rowOf("g"));
    expect(screen.queryByRole("button", { name: "Start supervisor" })).toBeNull();
  });

  it("u172_an_item_shows_a_grey_two_line_description_under_its_bold_title", async () => {
    styled();
    await mountTodos([todo(1, { title: "ship", body: "line one of the note" })]);
    await screen.findByRole("button", { name: /#1 ship/ });
    const description = document.querySelector(".item-description")!;

    expect(description.textContent).toBe("line one of the note");
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("u172_an_item_with_no_body_draws_no_description", async () => {
    styled();
    await mountTodos([todo(1)]);

    expect(document.querySelector(".item-description")).toBeNull();
  });
});
