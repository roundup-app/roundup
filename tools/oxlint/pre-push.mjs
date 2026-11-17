// T7331a-d: the pre-push hook. Oxlint without --fix on the web files the push changes, judged on the lines it adds, and the TypeScript 7 check of each project a changed file belongs to. It writes nothing to the tree.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorsOnAddedLines, reportErrors } from "./added-lines.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const bin = name => resolve(root, "node_modules/.bin", name);

const zeros = /^0+$/;

function capture(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => out.push(chunk));
    child.on("error", fail);
    child.on("close", status => done({ status, text: Buffer.concat(out).toString() }));
  });
}

const git = async args => {
  const result = await capture("git", args);

  return result.status === 0 ? result.text : null;
};

// Each pushed ref compares against the remote's ref, or against origin/main for a new branch or a remote sha this clone lacks.
async function bases() {
  const found = [];

  for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
    const [, local, , remote] = line.split(" ");

    if (zeros.test(local)) continue;

    for (const against of [zeros.test(remote) ? null : remote, "origin/main"]) {
      const base = against && (await git(["merge-base", against, local]))?.trim();

      if (base) {
        found.push(base);
        break;
      }
    }
  }

  return found;
}

function nearestProject(file) {
  for (let dir = dirname(resolve(root, file)); dir.startsWith(root); dir = dirname(dir)) {
    if (existsSync(resolve(dir, "tsconfig.json"))) return dir;
  }

  return null;
}

const webFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const typed = /\.(?:[cm]?ts|tsx)$/;

const failed = [];

for (const base of await bases()) {
  const names = (await git(["diff", "--name-only", "--diff-filter=d", "--relative", base, "--"])) ?? "";
  const files = names.split("\n").filter(file => file && existsSync(resolve(root, file)));
  const web = files.filter(file => webFile.test(file));
  const projects = [...new Set(files.filter(file => typed.test(file)).map(nearestProject).filter(Boolean))];

  const [linted, diff, ...checks] = await Promise.all([
    web.length ? capture(bin("oxlint"), ["--no-error-on-unmatched-pattern", "-f", "json", "--", ...web]) : null,
    git(["diff", base, "-U0", "--no-color", "--no-ext-diff", "--relative", "--"]),
    ...projects.map(project => capture(bin("tsc"), ["-p", project, "--pretty", "false"])),
  ]);

  if (linted) {
    const errors = errorsOnAddedLines(JSON.parse(linted.text).diagnostics, diff ?? "");

    reportErrors(errors);

    if (errors.length) failed.push("oxlint");
  }

  for (const check of checks) {
    if (check.status !== 0) {
      process.stderr.write(check.text);
      failed.push("tsc");
    }
  }
}

process.exit(failed.length ? 1 : 0);
