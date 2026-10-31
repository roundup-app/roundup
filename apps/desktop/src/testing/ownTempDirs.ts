import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { afterAll } from "vitest";

const made = new Set<string>();

const inTmp = (path: string) => path.startsWith(tmpdir());

const realSync = fs.mkdtempSync;
const realAsync = fs.promises.mkdtemp;

fs.mkdtempSync = ((...args: Parameters<typeof realSync>) => {
  const path = realSync(...args) as string;

  if (inTmp(path)) made.add(path);

  return path;
}) as typeof realSync;

fs.promises.mkdtemp = (async (...args: Parameters<typeof realAsync>) => {
  const path = (await realAsync(...args)) as string;

  if (inTmp(path)) made.add(path);

  return path;
}) as typeof realAsync;

syncBuiltinESMExports();

/** CI5330b: removes every temporary directory (browser profile, capture, Vite cache) this test file's process made and left behind. */
export const removeOwnTempDirs = () => {
  for (const path of made) fs.rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  made.clear();
};

afterAll(removeOwnTempDirs);
