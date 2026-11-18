import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";
import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

it("u7314h_no_failure_renders_outside_a_toast", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const failures: string[] = [];

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(tsx?|css)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;

    const path = join(entry.parentPath, entry.name);
    const name = relative(root, path);
    const text = readFileSync(path, "utf8");

    if (/ReservedLine|reserved-line/.test(text)) failures.push(`${name}: names ReservedLine`);

    if (!/\.tsx?$/.test(name) || name.startsWith("ink/") || name === "ui/Toast.tsx") continue;

    const errorNames = new Set(["ErrorLine"]);

    const tree = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });

    traverseFast(tree, node => {
      if (node.type === "ImportDeclaration" && node.source.value.endsWith("/ErrorLine")) failures.push(`${name}: imports ErrorLine`);

      if (node.type !== "JSXOpeningElement") return;

      if (node.name.type === "JSXIdentifier" && errorNames.has(node.name.name)) failures.push(`${name}: renders ErrorLine`);

      for (const attr of node.attributes) {
        if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier" || attr.name.name !== "role") continue;

        const value = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : attr.value;

        if (value?.type === "StringLiteral" && value.value === "alert") failures.push(`${name}: role="alert"`);
      }
    });
  }

  expect(failures).toEqual([]);
});
