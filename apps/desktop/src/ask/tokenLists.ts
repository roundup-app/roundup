import { createMemo, createSignal } from "solid-js";
import { segments, tokenAt } from "../state/askTokens";

type Item = { value: string; label: string };

/** U8045a, U8045b: the token under the caret, the list it opens and the tinted runs of the text. */
export const createTokenLists = (input: {
  text(): string;
  dismissed(): boolean;
  names(): readonly Item[];
  projects(): readonly { name: string }[];
  known(): readonly Item[];
}) => {
  const [caret, setCaret] = createSignal(0);
  const projectNames = () => input.projects().map(project => project.name);
  const workstreams = () => [...input.names(), ...input.known().filter(item => !input.names().some(seen => seen.value === item.value))];
  const typing = createMemo(() => tokenAt(input.text(), caret()));

  const matching = createMemo(() => {
    const token = typing();

    if (input.dismissed() || token === null) return [];
    const word = token.word.toLowerCase();
    const items = token.sigil === "#" ? projectNames().map(name => ({ value: name, label: name })) : workstreams();

    return items.filter(item => item.label.toLowerCase().includes(word));
  });

  const tinted = createMemo(() => segments(input.text(), projectNames(), workstreams().map(item => item.label)));

  return { setCaret, workstreams, typing, matching, tinted };
};
