import stylelint from 'stylelint';

const focusRingRule = 'roundup/no-focus-ring';

const noFocusRing = stylelint.createPlugin(focusRingRule, () => (root, result) => {
  root.walkDecls((declaration) => {
    if (!/^(outline(?:-.+)?|box-shadow)$/i.test(declaration.prop)) return;
    let focused = false;

    for (let parent = declaration.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' && /:focus(?:-visible|-within)?|\[\s*data-focus(?:-visible)?(?:[\]=\s])/i.test(parent.selector)) focused = true;
    }

    if (!focused && !/^outline(?:-.+)?$/i.test(declaration.prop)) return;

    if (/^(?:none|0(?:px)?)$/.test(declaration.value)) return;
    stylelint.utils.report({
      ruleName: focusRingRule, result, node: declaration,
      message: 'Focus rings are forbidden on every surface (U3528)',
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

const elevationRule = 'roundup/token-elevation';

const tokenElevation = stylelint.createPlugin(elevationRule, () => (root, result) => {
  if (root.source?.input.file?.endsWith('/apps/desktop/src/tokens.css')) return;
  root.walkDecls(/^box-shadow$/i, (declaration) => {
    stylelint.utils.report({
      ruleName: elevationRule, result, node: declaration,
      message: 'box-shadow is applied only in apps/desktop/src/tokens.css (U3512e)',
    });
  });
});

export default {
  plugins: ['stylelint-declaration-strict-value', noFocusRing, scrollDeclaresOverscroll, tokenElevation],
  rules: {
    [focusRingRule]: true,
    [elevationRule]: true,
    'declaration-property-value-allowed-list': {
      '/^z-index$/i': ['-1', '0', '1', /^var\(--layer-(?:drawer|popover|dialog|menu|tooltip|toast)\)$/],
    },
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
