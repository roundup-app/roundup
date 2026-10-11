import { resolve } from "node:path";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, door, USER } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

const tree = () => [door("r1", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "r1", name: "ann" })];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const A = { kind: "agent", id: "a", parent: "r1" } as const;

const LONG = "x".repeat(200);

const SHORT = "y".repeat(20);

const bodies = () => [...document.querySelectorAll<HTMLElement>("[data-message-body]")];

const image = "/tmp/shots/shot.PNG";

beforeEach(() => {
  // jsdom has no line boxes: a `.thread-clamped` body of more than 100 characters overflows its two lines.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("thread-clamped") && (this.textContent ?? "").length > 100 ? 400 : 40;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const controls = (id: number) => bodies().find((body) => body.getAttribute("data-message") === String(id))!;

describe("u352 every Message in the Thread opens in full, and an image shows", () => {
  it("u352_a_cut_body_of_any_sender_or_status_has_a_control", async () => {
    await mountThread(tree(), {
      messages: [
        message(1, { from: DOOR, to: "you", body: LONG }),
        message(2, { from: A, to: "you", body: LONG }),
        message(3, { from: DOOR, to: "you", body: LONG, status: "dropped" }),
        message(4, { from: DOOR, to: "you", body: LONG, status: "held" }),
        message(5, { from: DOOR, to: "you", body: SHORT }),
        message(6, { from: DOOR, to: "a", body: LONG }),
      ],
    });
    await vi.waitFor(() => expect(bodies()).toHaveLength(6));
    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "read more" })).toHaveLength(4));

    for (const id of [1, 2, 3, 4]) expect(controls(id).parentElement!.querySelector(".thread-read-more")).not.toBeNull();

    expect(controls(5).nextElementSibling?.querySelector("button") ?? null).toBeNull();
    // Between Agents the U189 fold is the control.
    expect(controls(6).querySelector("button.thread-fold")).not.toBeNull();
  });

  it("u352_opening_one_message_moves_no_other_row", async () => {
    await mountThread(tree(), { messages: [message(1, { from: DOOR, to: "you", body: LONG }), message(2, { from: DOOR, to: "you", body: LONG }), message(3, { from: USER, to: "r1", body: LONG })] });
    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "read more" })).toHaveLength(3));

    const states = () => bodies().map((body) => body.getAttribute("data-open"));
    const before = states();

    fireEvent.click(screen.getAllByRole("button", { name: "read more" })[0]!);

    expect(before).toEqual(["false", "false", "false"]);
    expect(states()).toEqual(["true", "false", "false"]);
    expect(screen.getAllByRole("button", { name: "show less" })[0]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("u352_a_dropped_message_opens_to_its_full_text", async () => {
    await mountThread(tree(), { messages: [message(1, { from: DOOR, to: "you", body: LONG, status: "dropped" })] });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "read more" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "read more" }));

    expect(bodies()[0]!.textContent).toContain(LONG);
    expect(bodies()[0]!.getAttribute("data-open")).toBe("true");
  });

  it("u352_an_image_in_a_message_shows_under_its_text", async () => {
    await mountThread(tree(), { messages: [message(1, { from: DOOR, to: "you", body: `look ${image}` })] });
    await vi.waitFor(() => expect(document.querySelector("[data-message-image]")).not.toBeNull());

    const shown = document.querySelector<HTMLImageElement>("[data-message-image] img")!;

    expect(shown.getAttribute("alt")).toBe("shot.PNG");
    expect(bodies()[0]!.nextElementSibling).toBe(document.querySelector("[data-message-image]"));
  });

  it("u352_an_unreadable_image_shows_its_name", async () => {
    await mountThread(tree(), { messages: [message(1, { from: A, to: "a", body: `see ${"/tmp/gone.PNG"}` }), message(2, { from: DOOR, to: "you", body: "no image /tmp/notes.txt" })] });
    await vi.waitFor(() => expect(document.querySelector("[data-message-image] img")).not.toBeNull());

    fireEvent.error(document.querySelector("[data-message-image] img")!);

    expect(document.querySelector("[data-message-image]")).toBeNull();
    expect(document.querySelector("[data-message-image-name]")!.textContent).toBe("gone.PNG");
  });

  it("u352_the_image_is_at_most_80ch_wide_and_480px_tall", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(resolve(process.cwd(), "src/thread/styles.css"), "utf8");
    const rule = css.slice(css.indexOf(".thread-image {"), css.indexOf("}", css.indexOf(".thread-image {")));

    expect(rule).toContain("max-width: 80ch");
    expect(rule).toContain("max-height: 480px");
    expect(rule).toContain("height: 480px");
  });
});
