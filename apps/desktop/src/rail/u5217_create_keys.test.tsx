import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { workstream, door } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const press = (init: KeyboardEventInit) => fireEvent.keyDown(document, init);

const footer = (label: string) => screen.getByRole("button", { name: label });

describe("u5215 one map names each kind's icon", () => {
  it("u5215_each_footer_button_shows_its_sections_icon", async () => {
    await mountRail([workstream("g")]);
    
    const kinds = { "Add Workstream": KIND_ICON.workstream, "New Mode": KIND_ICON.mode, "New Agent": KIND_ICON.agent };


    for (const [label, name] of Object.entries(kinds)) {

      const expected = render(() => <Icon name={name} />).container.querySelector("svg")?.getAttribute("class");


      expect(footer(label).querySelector("svg")?.getAttribute("class")).toBe(expected);
    }

    expect(footer("New Agent").querySelector("svg")?.getAttribute("class")).not.toContain("circle");
  });

  it("u5215_no_component_names_a_kinds_icon_directly", () => {
    // Status marks and other uses of these names that are not one of the three kinds.
    const allowed = new Set(["todos/TodoMeta.tsx"]); // the Todo owner chip: an Agent as owner, not a created kind

    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);

      return statSync(path).isDirectory() ? files(path) : name.endsWith(".tsx") && !/\.test\./.test(name) ? [path] : [];
    });

    const root = join(__dirname, "..");
    const offenders = files(root).filter(path => !allowed.has(path.slice(root.length + 1)) && /(?:name|icon)=\{?"(?:messages|workflow|bot)"|icon: "(?:messages|workflow|bot)"/.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
    expect(Object.values(KIND_ICON)).toEqual(["messages", "workflow", "bot"]);
  });
});

describe("u5217 the footer buttons show their key", () => {
  it("u5217_each_footer_button_exposes_its_chord_as_its_shortcut", async () => {
    await mountRail([workstream("g")]);

    expect(footer("Add Workstream").getAttribute("aria-keyshortcuts")).toBe("Alt+Meta+N");
    expect(footer("New Mode").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+M");
    expect(footer("New Agent").getAttribute("aria-keyshortcuts")).toBe("Meta+N");
    expect(footer("Add Workstream").querySelector("kbd")).not.toBeNull();
    expect(footer("New Mode").querySelector("kbd")).not.toBeNull();
    expect(footer("New Agent").querySelector("kbd")).not.toBeNull();
  });

  it("u5217_a_button_runs_the_action_its_chord_runs", async () => {
    const byClick = await mountRail([workstream("g")]);
    byClick.app.handlers["rail.createWorkstream"] = () => door("w1", "idle", "idle");
    fireEvent.click(footer("Add Workstream"));
    await waitFor(() => expect(railCallsTo(byClick.app, "rail.createWorkstream")).toHaveLength(1));
    cleanup();

    const byChord = await mountRail([workstream("g")]);
    byChord.app.handlers["rail.createWorkstream"] = () => door("w1", "idle", "idle");
    press({ key: "n", code: "KeyN", altKey: true, metaKey: true });
    await waitFor(() => expect(railCallsTo(byChord.app, "rail.createWorkstream")).toHaveLength(1));
  });
});
