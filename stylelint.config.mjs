import stylelint from 'stylelint';

const focusRingRule = 'roundup/shared-keyboard-ring';

const sharedKeyboardRing = stylelint.createPlugin(focusRingRule, () => (root, result) => {
  if (root.source?.input.file?.endsWith('/apps/desktop/src/styles.css')) return;
  root.walkDecls((declaration) => {
    if (!/^(outline(?:-.+)?|box-shadow)$/i.test(declaration.prop)) return;
    let focused = false;

    for (let parent = declaration.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' && /:focus(?:-visible|-within)?|\[\s*data-focus(?:-visible)?(?:[\]=\s])/i.test(parent.selector)) focused = true;
    }

    if (!focused) return;

    // Shadow-root consumers may reference the shared ring but cannot define another.
    if (/^var\(--keyboard-ring(?:-width|-color|-tree-offset)?\)$/.test(declaration.value)) return;

    if (/^(?:none|0(?:px)?)$/.test(declaration.value)) return;
    stylelint.utils.report({
      ruleName: focusRingRule, result, node: declaration,
      message: 'Draw focus rings only through the shared keyboard-mode rule in styles.css (U2770)',
    });
  });
});

const scrollRule = 'roundup/scroll-declares-overscroll';

const scrollDeclaresOverscroll = stylelint.createPlugin(scrollRule, () => (root, result) => {
  root.walkRules((rule) => {
    let scrolls = null;
    let contained = false;

    rule.each((node) => {
      if (node.type !== 'decl') return;
      const prop = node.prop.toLowerCase();

      if (/^overflow(-x|-y)?$/.test(prop) && /^(auto|scroll)\b/i.test(node.value)) scrolls ??= node;

      if (prop === 'overscroll-behavior') contained = true;
    });

    if (!scrolls || contained) return;

    stylelint.utils.report({
      ruleName: scrollRule, result, node: scrolls,
      message: 'A scroll area declares overscroll-behavior so its scroll stays inside it (U3785)',
    });
  });
});

export default {
  plugins: ['stylelint-declaration-strict-value', sharedKeyboardRing, scrollDeclaresOverscroll],
  rules: {
    [focusRingRule]: true,
    [scrollRule]: true,
    'scale-unlimited/declaration-strict-value': [
      ['padding'],
      {
        ignoreFunctions: false,
        disableFix: true,
        severity: 'error',
        ignoreValues: {
          padding: [0, 'inherit', 'initial', 'unset', 'revert', 'revert-layer'],
        },
      },
    ],
  },
};
