import { copy } from "./copy";
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { tagHighlighter, tags } from "@lezer/highlight";
import { createHighlightPlugin } from "prosemirror-highlight";
import { createParser } from "prosemirror-highlight/lezer";

export const languages = [
  LanguageDescription.of({ name: copy.languages.typescript, alias: ["ts", "tsx"], load: () => import("@codemirror/lang-javascript").then(module => module.javascript({ typescript: true, jsx: true })) }),
  LanguageDescription.of({ name: copy.languages.javascript, alias: ["js", "jsx"], load: () => import("@codemirror/lang-javascript").then(module => module.javascript({ jsx: true })) }),
  LanguageDescription.of({ name: copy.languages.python, alias: ["py"], load: () => import("@codemirror/lang-python").then(module => module.python()) }),
  // U7312c: CodeMirror's own diff mode marks removed and added lines.
  LanguageDescription.of({ name: copy.languages.diff, alias: ["patch"], load: () => import("@codemirror/legacy-modes/mode/diff").then(module => new LanguageSupport(StreamLanguage.define(module.diff))) }),
];

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: "pad-syntax-keyword" },
  { tag: tags.string, class: "pad-syntax-string" },
  { tag: tags.number, class: "pad-syntax-number" },
  { tag: tags.comment, class: "pad-syntax-comment" },
  { tag: tags.deleted, class: "pad-syntax-deleted" },
  { tag: tags.inserted, class: "pad-syntax-inserted" },
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

      if (!language) return [];

      if (!language.support) return language.load().then(() => {});

      return parse(options);
    },
  });
};
