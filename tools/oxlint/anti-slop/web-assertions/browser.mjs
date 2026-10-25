import { createRequire } from "node:module";

// Desktop already depends on Babel; use its parser for browser expressions in strings.
const requireDesktop = createRequire(new URL("../../../../apps/desktop/package.json", import.meta.url));
const { parseExpression } = requireDesktop("@babel/parser");
const { VISITOR_KEYS } = requireDesktop("@babel/types");
export const dimensions = /^(?:offset|client|scroll)(?:Width|Height|Top|Left)$|^(?:inner|outer)(?:Width|Height)$/;
export const geometry = new Set(["getBoundingClientRect", "getClientRects"]);
export const text = new Set(["textContent", "innerText", "innerHTML", "outerHTML"]);

export function browserEvidence(script) {
  const found = new Set();
  let root;
  try {
    root = parseExpression(script, { plugins: ["typescript", "jsx"] });
  } catch {
    return /document|window|getComputedStyle|=>|\breturn\b/.test(script) ? new Set(["unparsed-browser-script"]) : found;
  }
  function scan(node) {
    const name = ["MemberExpression", "OptionalMemberExpression"].includes(node.type)
      ? node.computed ? node.property.value : node.property.name : node.type === "Identifier" ? node.name : null;
    if (geometry.has(name) || dimensions.test(name ?? "") || name === "getComputedStyle") found.add("appearance");
    if (text.has(name)) found.add("dom-text");
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.filter(Boolean).forEach(scan);
      else if (child) scan(child);
    }
  }
  scan(root);
  return found;
}

export function pythonAssertionKinds(row) {
  const found = new Set(row.scripts.flatMap(script => [...browserEvidence(script)]));
  const kinds = [];
  if (found.has("appearance")) kinds.push("appearance");
  if (found.has("unparsed-browser-script")) kinds.push("unparsed-browser-script");
  if (row.literalComparison && found.has("dom-text")) kinds.push("copy-candidate");
  return kinds;
}
