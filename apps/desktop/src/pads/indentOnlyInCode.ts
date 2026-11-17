import type { CrepeBuilder } from "@milkdown/crepe/builder";
import { indentConfig, indentPlugin } from "@milkdown/kit/plugin/indent";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $shortcut } from "@milkdown/kit/utils";

/** Tab inserts the configured indent at the end of the selection when it starts in a code block; elsewhere it is not this key's. */
const codeIndent = $shortcut((ctx) => ({
  Tab: (state, dispatch) => {
    const { $from, to } = state.selection;

    if ($from.parent.type !== codeBlockSchema.type(ctx)) return false;

    const { type, size } = ctx.get(indentConfig.key);

    dispatch?.(state.tr.insertText(type === "tab" ? "\t" : " ".repeat(size), to));

    return true;
  },
}));

/** U7310g: Crepe always installs @milkdown/plugin-indent, which turns Tab into spaces in every block, so Tab never left the body. This swaps it, before `crepe` is created, for the indent in code alone; lists and tables keep their own Tab keymaps and any other block leaves Tab to the browser. */
export const indentOnlyInCode = (crepe: CrepeBuilder): CrepeBuilder => {
  void crepe.editor.remove(indentPlugin);
  crepe.editor.use(codeIndent);

  return crepe;
};
