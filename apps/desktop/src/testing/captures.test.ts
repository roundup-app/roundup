import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { captureDir } from "./captures";

const named = (value: string | undefined) => {
  if (value === undefined) delete process.env.ROUNDUP_CAPTURES;
  else process.env.ROUNDUP_CAPTURES = value;
};

afterEach(() => named(undefined));

test("l105_captureDir_names_a_directory_only_for_a_listed_id", () => {
  named(undefined);
  expect(captureDir("U361")).toBeNull();
  named("");
  expect(captureDir("U361")).toBeNull();
  named("U361, U196");
  expect(captureDir("U361")).toBe(resolve(process.cwd(), "../../artifacts/ux/U361"));
  expect(captureDir("U196")).toBe(resolve(process.cwd(), "../../artifacts/ux/U196"));
  expect(captureDir("U35")).toBeNull();
  expect(captureDir("U3611")).toBeNull();
});

test("l105_captureDir_writes_nothing", () => {
  named("U990");
  const dir = captureDir("U990");

  expect(dir).toBe(resolve(process.cwd(), "../../artifacts/ux/U990"));
  expect(existsSync(resolve(process.cwd(), "../../artifacts/ux/U990"))).toBe(false);
});

test("l105_no_capture_test_defines_its_own_artifact_path", () => {
  const own = new Set(["testing/captures.ts", "testing/captures.test.ts"]);
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !own.has(f));

  for (const file of files) {
    const text = readFileSync(join("src", file), "utf8");

    expect(text.includes("artifacts/ux"), `${file} holds its own artifact path`).toBe(false);
  }
});
