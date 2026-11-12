import { describe, expect, it } from "vitest";
import { idle, step } from "./pull";
import type { Pull } from "./pull";

const pressed = step(idle(), { type: "press", press: { x: 1, y: 2 }, selection: "w", target: null, pointerId: 1 });

const pulling = step(pressed, { type: "start" });

describe("u421 step", () => {
  it.each<[string, Pull, Parameters<typeof step>[1], Pull]>([
    ["u421_the_menu_after_a_pull_is_swallowed_once", step(pulling, { type: "release" }), { type: "menu" }, idle(false, true)],
    ["u421_the_release_after_a_pull_is_swallowed_once", idle(true, true), { type: "mouseup" }, idle(true, false)],
    ["u421_esc_ends_a_pull_and_swallows_its_menu", pulling, { type: "cancel" }, idle(true, true)],
    ["u421_a_plain_release_swallows_nothing", pressed, { type: "release" }, idle()],
    ["u421_a_menu_with_no_pull_is_not_swallowed", idle(), { type: "menu" }, idle()],
  ])("%s", (_name, from, event, to) => {
    expect(step(from, event)).toEqual(to);
  });
});
