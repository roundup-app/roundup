import assert from 'node:assert/strict';
import { test } from 'node:test';
import stylelint from 'stylelint';

const declarations = ['color: #fff', 'background-color: rgb(255 255 255)', 'border: 1px solid #fff', 'font-family: Arial', 'font-size: 13px', 'padding: 7px', 'margin-inline-start: 7px', 'gap: 7px', 'row-gap: 7px', 'border-radius: 7px', 'box-shadow: 0 1px 2px #000'];

test('u478_raw_values_fail_the_stylesheet_boundary', async () => {
  for (const declaration of declarations) {
    const result = await stylelint.lint({ code: `.probe { ${declaration}; }`, codeFilename: 'apps/desktop/src/u478-probe.css' });
    assert.equal(result.errored, true, declaration);
    assert.ok(result.results[0].warnings.some(warning => warning.rule === 'scale-unlimited/declaration-strict-value'), declaration);
  }
});
