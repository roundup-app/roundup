# U137 floating editor menu

1512×950, isolated headless agent-browser profile, light and dark. Base is `e5196a3b4`; head uses this PR's `checks.ts` on the same screen.

| Check | Base | Head |
| --- | --- | --- |
| D4, portaled menu | pass | pass |
| D8, menu surface with `--shadow-drawer` | fail | pass |

`loop/rules.sh delta artifacts/ux/U137/base artifacts/ux/U137/head` reports D8 fixed in both schemes and no regression. D1, D2, D3, D6, D7 and D10 fail in both versions of this observation; raw values and selectors are in each capture's JSON. D5, D9 and D11–D14/D16 remain passing.

The observation worktree temporarily enables Crepe's `blockEdit` on the main Pad editor, with `slashMenu.root` pointing to a body-mounted `.milkdown` container. Its menu surface uses the existing ground, text, radius, spacing and Drawer-shadow tokens; category and command hover backgrounds are transparent. The library owns keyboard and pointer interactions. This setup is not shipped by this PR.

Reproduce: open `tree-40`, select Pads, open the fourth Pad, focus its editor, select all and type `Menu observer`, then Enter and `/`. Capture the open menu and `window.__checks()` in each scheme. The behavioral observer `u137_editor_menu_is_not_an_item_row` separately covers the default Drawer-root category/command lists and rejects a real item row after its Kind glyph is removed. `u137_floating_menu_shadow_keeps_unrelated_shadow_rejection` measures computed token shadows in both schemes and rejects that same shadow on unrelated content, arbitrary shadows on menu descendants and an arbitrary menu-surface shadow.
