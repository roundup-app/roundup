import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Layout } from "../app/Layout";
import { createWidths } from "./widths";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("u4459_the_widths_leave_the_centre_its_minimum", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  const style = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
    const computed = style(element);
    vi.spyOn(computed, "getPropertyValue").mockImplementation(name => ({ "--rail-width": "480px", "--shelf-span": "560px", "--centre-min-width": "388px" })[name] ?? "");

    return computed;
  });
  let available = 0;
  render(() => {
    const widths = createWidths(() => "/p");
    widths.rail.commit(10000);
    widths.shelf.commit(10000);
    available = 1280 - widths.rail.now();

    return <Layout widths={widths} header={null} rail={null} centre={null} shelf={null} overlay={null} />;
  });
  expect(available).toBeGreaterThanOrEqual(388);
  // At the two maxima the Shelf must overlay; reserving both widths leaves only 240 px.
  expect(document.querySelector(".window")?.getAttribute("data-shelf-mode")).toBe("overlay");
});
