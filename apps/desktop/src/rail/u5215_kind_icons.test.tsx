import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

describe("u5215 one map names each kind's icon", () => {
  it("u5215_menus_entries_and_help_read_the_map", () => {
    // Menus, ⌘K entries and Help are .ts or .tsx; none may carry a kind's icon name as a literal.
    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);

      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });

    const root = join(__dirname, "..");
    const allowed = new Set(["ink/kindIcon.ts", "todos/TodoMeta.tsx"]);
    const offenders = files(root).filter(path => !allowed.has(path.slice(root.length + 1)) && /icon\w*\W{1,3}["'](?:messages|workflow|bot)["']/i.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("u5215_no_component_names_a_kinds_icon_directly", () => {
    // Status marks and other uses of these names that are not one of the three kinds.
    const allowed = new Set(["todos/TodoMeta.tsx"]); // the Todo owner chip: an Agent as owner, not a created kind (Icon name="bot")

    const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name);

      return statSync(path).isDirectory() ? files(path) : name.endsWith(".tsx") && !/\.test\./.test(name) ? [path] : [];
    });

    const root = join(__dirname, "..");
    const offenders = files(root).filter(path => !allowed.has(path.slice(root.length + 1)) && /(?:name|icon)=\{?"(?:messages|workflow|bot)"|icon: "(?:messages|workflow|bot)"/.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
  });
});
