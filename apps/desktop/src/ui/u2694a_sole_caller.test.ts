import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

it("u2694a_the_helper_is_the_only_caller_of_the_command", () => {
  const callers = sources(join(__dirname, "..")).filter((path) => /\.showContextMenu\(/.test(readFileSync(path, "utf8")));

  expect(callers.map((path) => path.split("/src/")[1])).toEqual(["ui/contextMenu.ts"]);
});
