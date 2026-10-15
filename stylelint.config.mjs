export default {
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
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
