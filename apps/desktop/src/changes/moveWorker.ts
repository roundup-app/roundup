import { configure } from "@plannotator/sem-jiff";
import type { LanguageId } from "@plannotator/sem-jiff";
import { movedIn } from "./moveFile";
import type { Moved, MoveRequest } from "./moves";

/** U7696b: each grammar loads only when a file of its language is read. */
const GRAMMARS: Partial<Record<LanguageId, () => Promise<{ default: string }>>> = {
  typescript: () => import("@plannotator/sem-jiff/wasm/tree-sitter-typescript.wasm?url"),
  tsx: () => import("@plannotator/sem-jiff/wasm/tree-sitter-tsx.wasm?url"),
  python: () => import("@plannotator/sem-jiff/wasm/tree-sitter-python.wasm?url"),
  go: () => import("@plannotator/sem-jiff/wasm/tree-sitter-go.wasm?url"),
  rust: () => import("@plannotator/sem-jiff/wasm/tree-sitter-rust.wasm?url"),
  java: () => import("@plannotator/sem-jiff/wasm/tree-sitter-java.wasm?url"),
  php: () => import("@plannotator/sem-jiff/wasm/tree-sitter-php.wasm?url"),
};

/** The production build ships each grammar gzipped (`vite.config.ts`), so the shipped bytes stay under C9c's cap; the dev server serves it as it is. */
const grammar = async (language: LanguageId) => {
  const load = GRAMMARS[language];

  if (!load) throw new Error(`no grammar for ${language}`);
  const { default: url } = await load();

  if (!import.meta.env.PROD) return url;
  const response = await fetch(`${url}.gz`);

  if (!response.ok) throw new Error(`grammar ${language}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // A server that sets Content-Encoding has inflated the file already.
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()) : bytes;
};

configure({ locateGrammar: (_file, language) => grammar(language) });

/** The Worker's answer to one request: the marks, or the cause the read failed. */
export type MoveReply = { id: number } & ({ moved: Moved[] } | { cause: string });

addEventListener("message", async ({ data }: MessageEvent<{ id: number } & MoveRequest>) => {
  const { id, ...request } = data;

  try {
    return postMessage({ id, moved: await movedIn(request) } satisfies MoveReply);
  } catch (error) {
    return postMessage({ id, cause: error instanceof Error ? error.message : String(error) } satisfies MoveReply);
  }
});
