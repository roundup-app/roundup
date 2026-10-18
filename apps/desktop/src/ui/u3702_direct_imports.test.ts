import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], { cwd, encoding: "utf8" });

it("u3702_two_primitives_added_on_two_branches_merge_cleanly", () => {
  const repo = mkdtempSync(join(tmpdir(), "u3702-"));

  try {
    const ui = join(repo, "apps/desktop/src/ui");
    cpSync(import.meta.dirname, ui, { recursive: true, filter: (p) => !p.includes("evidence") });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");

    for (const name of ["Alpha", "Beta"]) {
      git(repo, "checkout", "-q", "-b", name.toLowerCase(), "main");
      writeFileSync(join(ui, `${name}.tsx`), `export const ${name} = 1;\n`);
      mkdirSync(join(repo, `apps/desktop/src/${name.toLowerCase()}`), { recursive: true });
      writeFileSync(join(repo, `apps/desktop/src/${name.toLowerCase()}/Use.tsx`), `import { ${name} } from "../ui/${name}";\nexport const use = ${name};\n`);
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", name);
    }

    git(repo, "checkout", "-q", "alpha");
    git(repo, "merge", "-q", "--no-edit", "beta");
    expect(git(repo, "diff", "--name-only", "--diff-filter=U")).toBe("");

    for (const f of ["Alpha.tsx", "Beta.tsx"]) expect(existsSync(join(ui, f))).toBe(true);
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
  }
});

it("u3702_no_ui_file_re_exports_the_primitives", () => {
  expect(existsSync(join(import.meta.dirname, "index.tsx"))).toBe(false);

  const files = readdirSync(import.meta.dirname).filter((f) => /\.tsx?$/.test(f) && f !== "u3702_direct_imports.test.ts");
  const reExports = files.filter((f) => /^export\s[^;]*\sfrom\s+"\.\//m.test(readFileSync(join(import.meta.dirname, f), "utf8")));

  expect(reExports).toEqual([]);
});
