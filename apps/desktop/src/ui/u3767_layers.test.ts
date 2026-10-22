import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);

  return statSync(path).isDirectory() ? files(path) : [path];
});

const sources = files(SRC).filter((path) => /\.(css|tsx)$/.test(path) && !/\.test\./.test(path));

it("u3767_floating_surfaces_take_layers_from_tokens_in_one_order", () => {
  const tokens = readFileSync(join(SRC, "tokens.css"), "utf8");
  const layer = (name: string) => Number(new RegExp(`--layer-${name}:\\s*(\\d+)`).exec(tokens)?.[1]);

  expect([layer("popover"), layer("drawer"), layer("dialog"), layer("menu"), layer("toast")]).toEqual(
    [layer("popover"), layer("popover") + 1, layer("popover") + 2, layer("popover") + 3, layer("popover") + 4]);
  expect(layer("popover")).toBeGreaterThan(0);

  // A file holding only floating surfaces sets no number; a mixed file names its Token on the floating selector.
  const only = ["ui/Popover.css", "ui/Tooltip.css", "ui/Dialog.css", "ui/Menu.css", "ui/Select.css", "ui/Toast.css", "switcher/styles.css", "toasts/styles.css", "ask/styles.css", "keys/keysFixture.tsx"];
  const mixed = ["rail/styles.css", "styles.css", "terminal/styles.css", "todos/rowButton.styles.css"];
  const read = (name: string) => readFileSync(sources.find((path) => path.endsWith(`/${name}`))!, "utf8");

  for (const name of only) expect(read(name), `${name} sets its own z-index`).not.toMatch(/z-index"?:\s*"?\d/);

  for (const name of mixed) expect(read(name), name).toMatch(/z-index: var\(--layer-/);
});
