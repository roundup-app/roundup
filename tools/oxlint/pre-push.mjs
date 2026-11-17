// T7331a-d, T7357a: the pre-push hook. Oxlint without --fix on the web files the push changes, judged on the lines it adds, and the TypeScript 7 check of each project a changed file belongs to. It judges a snapshot of each pushed commit, never the working tree, and writes nothing to the tree.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorsOnAddedLines, reportErrors } from "./added-lines.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const bin = name => resolve(root, "node_modules/.bin", name);

const zeros = /^0+$/;

function capture(command, cwd, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => out.push(chunk));
    child.on("error", fail);
    child.on("close", status => done({ status, text: Buffer.concat(out).toString() }));
  });
}

const git = async args => {
  const result = await capture("git", root, args);

  return result.status === 0 ? result.text : null;
};

// Each pushed ref pairs its commit with a base: it compares against the remote's ref, or against origin/main for a new branch or a remote sha this clone lacks.
async function bases() {
  const found = [];

  for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
    const [, local, , remote] = line.split(" ");

    if (zeros.test(local)) continue;

    for (const against of [zeros.test(remote) ? null : remote, "origin/main"]) {
      const base = against && (await git(["merge-base", against, local]))?.trim();

      if (base) {
        found.push({ base, local });
        break;
      }
    }
  }

  return found;
}

// The commit's files in a temp dir, with each package's installed node_modules linked in.
async function snapshot(local) {
  const dir = mkdtempSync(resolve(tmpdir(), "roundup-pre-push-"));
  const files = ((await git(["ls-tree", "-r", "--name-only", local])) ?? "").split("\n");

  await new Promise((done, fail) => {
    const archive = spawn("sh", ["-c", 'git archive "$0" | tar -x -C "$1"', local, dir], { cwd: root, stdio: "ignore" });
    archive.on("error", fail);
    archive.on("close", done);
  });

  for (const file of files.filter(file => file === "package.json" || file.endsWith("/package.json"))) {
    const installed = resolve(root, dirname(file), "node_modules");

    if (existsSync(installed)) symlinkSync(installed, resolve(dir, dirname(file), "node_modules"), "dir");
  }

  return dir;
}

function nearestProject(file, root) {
  for (let dir = dirname(resolve(root, file)); dir.startsWith(root); dir = dirname(dir)) {
    if (existsSync(resolve(dir, "tsconfig.json"))) return dir;
  }

  return null;
}

const webFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const typed = /\.(?:[cm]?ts|tsx)$/;

const failed = [];

for (const { base, local } of await bases()) {
  const dir = await snapshot(local);
  const names = (await git(["diff", "--name-only", "--diff-filter=d", "--relative", base, local, "--"])) ?? "";
  const files = names.split("\n").filter(file => file && existsSync(resolve(dir, file)));
  const web = files.filter(file => webFile.test(file));
  const projects = [...new Set(files.filter(file => typed.test(file)).map(file => nearestProject(file, dir)).filter(Boolean))];

  const [linted, diff, ...checks] = await Promise.all([
    web.length ? capture(bin("oxlint"), dir, ["--no-error-on-unmatched-pattern", "-f", "json", "--", ...web]) : null,
    git(["diff", base, local, "-U0", "--no-color", "--no-ext-diff", "--relative", "--"]),
    ...projects.map(project => capture(bin("tsc"), dir, ["-p", project, "--pretty", "false"])),
  ]);

  if (linted) {
    process.chdir(dir);
    const errors = errorsOnAddedLines(JSON.parse(linted.text).diagnostics, diff ?? "");
    process.chdir(root);

    reportErrors(errors);

    if (errors.length) failed.push("oxlint");
  }

  for (const check of checks) {
    if (check.status !== 0) {
      process.stderr.write(check.text);
      failed.push("tsc");
    }
  }

  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed.length ? 1 : 0);
