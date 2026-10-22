import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { mountControl } from "./harness";
import { openDiff, saveNote } from "./noteHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom has no layout: a box 100 wide holds as many characters as it has text length. */
const layout = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
};

const facts = async () => {
  await mountControl();
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));

  return await waitFor(() => {
    const dds = [...document.querySelectorAll<HTMLElement>(".worktree-facts dd")];

    if (dds.length < 2) throw new Error("panel not ready");

    return dds;
  });
};

it("u3296b_a_cut_name_has_its_full_text_as_title", async () => {
  layout(400);
  const [branch, base] = await facts();

  await waitFor(() => expect(branch!.getAttribute("title")).toBe("roundup/a"));
  expect(base!.getAttribute("title")).toBe("main");
});

it("u3296b_a_name_that_fits_has_no_title", async () => {
  layout(50);
  const [branch, base] = await facts();

  await Promise.resolve();
  expect(branch!.hasAttribute("title")).toBe(false);
  expect(base!.hasAttribute("title")).toBe(false);
});

it("u3296a_repeating_text_opens_no_tooltip", async () => {
  layout(400);
  const [branch, base] = await facts();

  for (const dd of [branch!, base!]) {
    fireEvent.pointerMove(dd, { pointerType: "mouse" });
    dd.focus();
  }

  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

const notePath = async () => {
  await openDiff();
  await saveNote("a note");

  return await waitFor(() => {
    const path = document.querySelector<HTMLElement>(".note-path");

    if (!path) throw new Error("note not listed");

    return path;
  });
};

it("u3296b_a_cut_note_path_has_its_full_text_as_title", async () => {
  layout(400);
  const path = await notePath();

  await waitFor(() => expect(path.getAttribute("title")).toBe("src/a.ts"));
});

it("u3296b_a_note_path_that_fits_has_no_title", async () => {
  layout(50);
  const path = await notePath();

  await Promise.resolve();
  expect(path.hasAttribute("title")).toBe(false);
});

it("u3296a_a_note_path_opens_no_tooltip", async () => {
  layout(400);
  const path = await notePath();

  fireEvent.pointerMove(path, { pointerType: "mouse" });
  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
