import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

it("u3701_two_components_styled_on_two_branches_merge_cleanly", () => {
  const repo = mkdtempSync(join(tmpdir(), "u3701-"));

  try {
    const ui = join(repo, "apps/desktop/src/ui");
    cpSync(join(import.meta.dirname), ui, { recursive: true, filter: (p) => !p.includes("evidence") });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");

    for (const name of ["Alpha", "Beta"]) {
      git(repo, "checkout", "-q", "-b", name.toLowerCase(), "main");
      writeFileSync(join(ui, `${name}.css`), `.app-${name.toLowerCase()} {\n  color: var(--text);\n}\n`);
      writeFileSync(join(ui, `${name}.tsx`), `import "./${name}.css";\nexport const ${name} = 1;\n`);
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", name);
    }

    git(repo, "checkout", "-q", "alpha");
    git(repo, "merge", "-q", "--no-edit", "beta");
    expect(git(repo, "diff", "--name-only", "--diff-filter=U")).toBe("");

    for (const f of ["Alpha.css", "Alpha.tsx", "Beta.css", "Beta.tsx"]) expect(existsSync(join(ui, f))).toBe(true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

it("u3701_styles_css_is_gone_and_no_ui_file_imports_it", () => {
  expect(existsSync(join(import.meta.dirname, "styles.css"))).toBe(false);
  expect(readFileSync(join(import.meta.dirname, "Dialog.tsx"), "utf8")).not.toMatch(/"\.\/styles\.css"/);
});
