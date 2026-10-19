import stylelint from 'stylelint';

const focusRingRule = 'roundup/shared-keyboard-ring';

const sharedKeyboardRing = stylelint.createPlugin(focusRingRule, () => (root, result) => {
  if (root.source?.input.file?.endsWith('/apps/desktop/src/styles.css')) return;
  root.walkDecls((declaration) => {
    if (!/^(outline(?:-.+)?|box-shadow)$/.test(declaration.prop)) return;
    let focused = false;

    for (let parent = declaration.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' && /:focus(?:-visible|-within)?|\[data-focus(?:-visible)?(?:[\]=\s])/.test(parent.selector)) focused = true;
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

export default {
  plugins: ['stylelint-declaration-strict-value', sharedKeyboardRing],
  rules: {
    [focusRingRule]: true,
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
