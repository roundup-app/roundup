import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("u471_previous_copy_assertions_are_preserved_resize_edge_names_use_sentence_case_and_keep_glossary_capitals", async () => {
  const controls = seedApp("tree-40", Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);

  expect(await screen.findByRole("separator", { name: "Resize Rail" })).toBeTruthy();
  expect(screen.getByRole("separator", { name: "Resize work items" })).toBeTruthy();
});
