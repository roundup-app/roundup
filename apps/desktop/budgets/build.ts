import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** R3800/C9 share the production bundler's module identities, bound to emitted bytes. */
export const buildModules = (): Plugin => ({
  name: "roundup-build-modules",
  apply: "build",
  writeBundle: {
    order: "post",
    handler(options, bundle) {
      if (!options.dir) throw new Error("production output directory is missing");
      const root = resolve(options.dir);
      const manifest = resolve(root, ".vite/manifest.json");

      // C9 counts shipped metadata too; compact it before hashing so the inventory still binds the emitted bytes.
      writeFileSync(manifest, JSON.stringify(JSON.parse(readFileSync(manifest, "utf8"))));

      const files = Object.fromEntries([...Object.keys(bundle), ".vite/manifest.json"].map(file => [
        file, createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex"),
      ]));

      const chunks = Object.fromEntries(Object.entries(bundle).flatMap(([file, output]) => output.type === "chunk" ? [[file, Object.entries(output.modules).filter(([, module]) => module.renderedLength > 0).map(([id]) => id)]] : []));

      mkdirSync(resolve(root, ".vite"), { recursive: true });
      writeFileSync(resolve(root, ".vite/modules.json"), JSON.stringify({ files, chunks }));
    },
  },
});
