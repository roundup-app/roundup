import stylelint from 'stylelint';

const focusRingRule = 'roundup/no-focus-ring';

const noFocusRing = stylelint.createPlugin(focusRingRule, () => (root, result) => {
  root.walkDecls((declaration) => {
    if (!/^(outline(?:-.+)?|box-shadow)$/i.test(declaration.prop)) return;

    if (root.source?.input.file?.endsWith('/apps/desktop/src/ui/Field.css') &&
        declaration.prop === 'outline' && declaration.value === 'var(--stroke-width) solid var(--accent)' &&
        declaration.parent?.type === 'rule' && declaration.parent.selector.split(/,\s*\n/).every(selector =>
          /(?:\[data-scope="(?:field|number-input|date-picker)"\]|\.app-(?:select-trigger|combobox-input|checkbox|switch|radio|dialog-form)|\.(?:import-prompt|note-form))/.test(selector))) return;

    if (root.source?.input.file?.endsWith('/apps/desktop/src/ui/Field.css') && declaration.prop === 'outline-offset' && declaration.value === 'var(--stroke-width)') return;

    // U4685 allows paint on these region owners only; descendants keep U3528.
    if (root.source?.input.file?.endsWith('/apps/desktop/src/tokens.css') &&
        declaration.parent?.type === 'rule' && ['.drawer:focus-within',
          '.columns:has(> .rail:focus-within)::after,\n.pane:focus-within::after,\n.shelf:focus-within::after,\n.window:has(.shelf-tabs:focus-within) .shelf::after'].includes(declaration.parent.selector) &&
        ((declaration.prop === 'outline' && declaration.value === 'var(--hairline-width) solid var(--accent)') ||
         (declaration.prop === 'outline-offset' && declaration.value === 'calc(-1 * var(--hairline-width))'))) return;
    let focused = false;

    for (let parent = declaration.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' && /:focus(?:-visible|-within)?|\[\s*data-focus(?:-visible)?(?:[\]=\s])/i.test(parent.selector)) focused = true;
    }

    if (!focused && !/^outline(?:-.+)?$/i.test(declaration.prop)) return;

    if (/^(?:none|0(?:px)?)$/.test(declaration.value)) return;
    stylelint.utils.report({
      ruleName: focusRingRule, result, node: declaration,
      message: 'Control rings are forbidden except shared forms (U4382a); region paint is U4685',
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

const containerRule = 'roundup/container-token-threshold';

// The built-in unit rule visits media preludes, but not container preludes.
const containerTokenThreshold = stylelint.createPlugin(containerRule, () => async (root, result) => {
  const queries = [];
  root.walkAtRules(/^container$/i, query => { queries.push(query); });

  for (const query of queries) {
    const media = query.clone({ name: 'media', params: query.params.slice(query.params.indexOf('(')) });
    media.removeAll();
    const probe = root.clone().removeAll().append(media);

    await stylelint.utils.checkAgainstRule({
      ruleName: 'unit-disallowed-list', ruleSettings: ['px', 'ms', 's', 'rem'], root: probe,
    }, warning => {
      stylelint.utils.report({ ruleName: containerRule, result, node: query, message: warning.text });
    });
  }
});

export default {
  plugins: ['stylelint-declaration-strict-value', noFocusRing, scrollDeclaresOverscroll, tokenElevation, containerTokenThreshold],
  overrides: [{ files: ['**/tokens.css'], rules: {
    'unit-disallowed-list': null,
    'color-no-hex': null,
    'color-named': null,
    'declaration-property-value-disallowed-list': null,
    [containerRule]: null,
  } }],
  rules: {
    'declaration-no-important': true,
    'unit-disallowed-list': ['px', 'ms', 's'],
    'selector-max-compound-selectors': 2,
    'selector-combinator-disallowed-list': ['>'],
    'color-no-hex': true,
    'color-named': 'never',
    'declaration-property-value-disallowed-list': {
      '/.*/': [/(?<![-\w])transparent\b/i, /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^;]*?[\s,(/][+-]?(?:\d|\.\d)/i],
    },
    [containerRule]: true,
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
