import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tagHighlighter, tags } from "@lezer/highlight";
import { createHighlightPlugin } from "prosemirror-highlight";
import { createParser } from "prosemirror-highlight/lezer";

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: "pad-syntax-keyword" },
  { tag: tags.string, class: "pad-syntax-string" },
  { tag: tags.number, class: "pad-syntax-number" },
  { tag: tags.comment, class: "pad-syntax-comment" },
]);

/** U5562c: library-owned decorations and cached lazy languages leave the code document untouched. */
export const codeColours = () => {
  const parse = createParser({
    highlighter,
    parse: ({ content, language }) => language
      ? LanguageDescription.matchLanguageName(languages, language, false)?.support?.language.parser.parse(content)
      : undefined,
  });

  return createHighlightPlugin({
    parser: options => {
      const language = options.language ? LanguageDescription.matchLanguageName(languages, options.language, false) : undefined;

      // Visual fences keep their existing renderer and never request a programming language.
      if (!language || options.language === "mermaid" || options.language === "excalidraw") return [];

      if (!language.support) return language.load().then(() => {});

      return parse(options);
    },
  });
};
