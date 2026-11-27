import { expect, it } from "vitest";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import { movedIn } from "./moveFile";
import { leftFiles, MAX_CHARS, readable, sameBody } from "./moves";

// U7696d, U7696g: the reader on the real engine, and the match of code that left one file for another.

const OLD = "export const MAX_RETRIES = 3;\nexport function loadUser(id) {\n  return db.get(id);\n}\nexport function saveUser(user) {\n  return db.put(user, MAX_RETRIES);\n}\nexport function other() {\n  const a = 1;\n  return a + MAX_RETRIES;\n}\n";

const NEW = "export const MAX_ATTEMPTS = 3;\nexport function saveUser(user) {\n  return db.put(user, MAX_ATTEMPTS);\n}\nexport function other() {\n  const a = 1;\n  return a + MAX_ATTEMPTS;\n}\nexport function loadUser(id) {\n  return db.get(id);\n}\n";

it("u7696d_the_reader_claims_moves_and_renames_and_leaves_the_rest_plain", async () => {
  expect(await movedIn({ path: "a.ts", old: OLD, new: NEW })).toEqual([
    { kind: "moved", lines: [{ start: 9, end: 11 }], from: { path: "a.ts", start: 2, end: 4 } },
    { kind: "renamed", lines: [{ start: 1, end: 1 }, { start: 3, end: 3 }, { start: 7, end: 7 }], was: "MAX_RETRIES", now: "MAX_ATTEMPTS" },
  ]);

  // A moved function that was also edited is a plain edit.
  const edited = NEW.replace("return db.get(id);", "const found = db.get(id);\n  return found;");

  expect((await movedIn({ path: "a.ts", old: OLD, new: edited })).filter(each => each.kind === "moved")).toEqual([]);

  // A language not read and a file over the cap are not read at all.
  expect(await movedIn({ path: "a.kt", old: OLD, new: NEW })).toEqual([]);
  expect(readable("typescript", "x".repeat(MAX_CHARS), "y")).toBe(false);
});

const symbol = (path: string, name: string, status: "added" | "removed", lines = { start: 10, end: 13 }): ChangedSymbol => ({ key: `${path}##${name}#function`, name, kind: "function", path, old: status === "removed" ? lines : null, new: status === "added" ? lines : null, status, callable: true });

it("u7696g_only_a_clear_pair_with_a_whole_body_is_a_candidate", () => {
  const pair = [symbol("a.ts", "legacy", "removed"), symbol("b.ts", "legacy", "added")];

  expect(leftFiles(pair)).toHaveLength(1);

  // Two removed, or two added, of one name; one file; and no other file to hold it.
  expect(leftFiles([...pair, symbol("c.ts", "legacy", "removed")])).toEqual([]);
  expect(leftFiles([...pair, symbol("c.ts", "legacy", "added")])).toEqual([]);
  expect(leftFiles([symbol("a.ts", "legacy", "removed"), symbol("a.ts", "legacy", "added")])).toEqual([]);

  // The body: equal through indentation and blank lines, over at least 3 lines, and changed means plain edits.
  const body = "function f() {\n  const a = 1;\n  return a;\n}\n";

  expect(sameBody(body, { start: 1, end: 4 }, body.replace(/^ +/gm, "      ").replace("}", "}\n\n"), { start: 1, end: 5 })).toBe(true);
  expect(sameBody(body, { start: 1, end: 4 }, body.replace("return a", "return 2"), { start: 1, end: 4 })).toBe(false);
  expect(sameBody("a;\nb;\n", { start: 1, end: 2 }, "a;\nb;\n", { start: 1, end: 2 })).toBe(false);
});
