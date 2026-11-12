import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createProjectView } from "./projectView";

const view = (openShelf = vi.fn()) => createRoot(() => ({ openShelf, view: createProjectView(() => "w1", openShelf) }));

describe("U4457 a request opens the Shelf where it is made", () => {
  it("u4457_a_creation_request_opens_the_shelf_once", () => {
    const { openShelf, view: v } = view();

    v.createIn("todo", "w1");
    expect(openShelf).toHaveBeenCalledExactlyOnceWith("todos");
    v.createIn("pad", "w1");
    expect(openShelf).toHaveBeenLastCalledWith("pads");
  });

  it("u4457_a_creation_request_is_taken_by_a_list_that_mounts_later", () => {
    const { view: v } = view();

    v.createIn("pad", "w1");
    expect(v.creation()).toEqual({ kind: "pad", home: "w1" });
    v.finishCreation();
    expect(v.creation()).toBeNull();
  });

  it("u4457_a_terminal_request_does_not_open_the_shelf", () => {
    const { openShelf, view: v } = view();

    v.createIn("terminal", "w1");
    expect(openShelf).not.toHaveBeenCalled();
    expect(v.creation()?.kind).toBe("terminal");
  });

  it("u370_a_pads_request_opens_the_shelf_on_pads", () => {
    const { openShelf, view: v } = view();

    v.showPadsOf("a1");
    expect(openShelf).toHaveBeenCalledExactlyOnceWith("todos");
    expect(v.padsRequest()).toBe("a1");
    expect(v.padsOwner()).toBe("a1");
  });
});
