import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ReservedLine } from "./ReservedLine";

afterEach(cleanup);

it("u3807_the_line_form_is_mounted_without_a_message_and_keeps_its_height", () => {
  const [message, setMessage] = createSignal<string | null>(null);
  const { container } = render(() => <section><button>Before</button><ReservedLine message={message()} /><button>After</button></section>);
  const surface = container.firstElementChild!;
  const nodes = [...surface.children];
  expect(screen.queryByRole("alert")).toBeNull();
  setMessage("Could not save\nTry again");
  expect(screen.getByRole("alert").closest(".reserved-line")?.getAttribute("title")).toBe("Could not save\nTry again");
  expect([...surface.children]).toEqual(nodes);
  setMessage(null);
  expect(screen.queryByRole("alert")).toBeNull();
  expect([...surface.children]).toEqual(nodes);
});

it("u3807_the_overlay_form_is_out_of_flow", () => {
  const [message, setMessage] = createSignal<string | null>(null);
  const { container } = render(() => <section><ReservedLine overlay message={message()} /><input aria-label="Draft" /></section>);
  const surface = container.firstElementChild!;
  const nodes = [...surface.children];
  setMessage("Could not send");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect([...surface.children]).toEqual(nodes);
  setMessage(null);
  expect([...surface.children]).toEqual(nodes);
});

it("u3807_a_new_status_replaces_the_previous_status_in_the_same_place", () => {
  const [status, setStatus] = createSignal("Original name changed");
  const view = render(() => <ReservedLine status={status()} />);
  const place = view.container.firstElementChild;
  setStatus("Original object unavailable");
  expect(screen.getByRole("status").textContent).toBe("Original object unavailable");
  expect(view.container.firstElementChild).toBe(place);
});

it("u3807_no_message_renders_outside_the_reserved_line", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const failures: string[] = [];

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;

    const path = join(entry.parentPath, entry.name);
    const name = relative(root, path);
    const text = readFileSync(path, "utf8");

    const tree = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const errorNames = new Set(["ErrorLine"]);

    traverseFast(tree, node => {
      if (node.type !== "ImportDeclaration" || !node.source.value.endsWith("/ErrorLine")) return;

      if (!name.startsWith("ink/")) failures.push(name);

      for (const specifier of node.specifiers) errorNames.add(specifier.local.name);
    });
    traverseFast(tree, node => {
      if (node.type !== "JSXOpeningElement") return;

      if (node.name.type === "JSXIdentifier" && errorNames.has(node.name.name) && name !== "ink/ReservedLine.tsx") failures.push(name);

      if (name.startsWith("ink/")) return;

      for (const attr of node.attributes) {
        if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier" || attr.name.name !== "role") continue;

        const value = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : attr.value;

        if (value?.type === "StringLiteral" && (value.value === "alert" || value.value === "status")) failures.push(name);
      }
    });
  }

  expect(failures).toEqual([]);
});
