import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// U478 prerequisite only: native media selection, not Token regression evidence.
const directory = mkdtempSync(join(tmpdir(), 'u478-contrast-'));

const config = join(directory, 'config.json');

writeFileSync(config, '{"headed":false}');

const browser = process.argv[2] ?? join(homedir(), '.agent-browser/browsers/chrome-155.0.8059.79/chrome');

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));

function command(args, executable = 'agent-browser') {
  if (executable === 'agent-browser') args = ['--config', config, ...args];
  const result = spawnSync(executable, args, { cwd: directory, env, encoding: 'utf8', timeout: 60_000 });
  console.log(JSON.stringify({ command: [executable, ...args], exit: result.status,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
  assert.equal(result.status, 0, 'agent-browser command failed');

  return result.stdout.trim();
}

test('u478_native_contrast_selects_stylesheet', () => {
  try {
    assert.equal(process.platform, 'linux', 'This observer pins Linux Chrome for Testing');
    assert.equal(command(['--version']), 'agent-browser 0.27.0');
    assert.match(command(['--version'], browser), /^Google Chrome for Testing 155\.0\.8059\.79/);
    const fixture = join(directory, 'media.html');
    writeFileSync(fixture, '<!doctype html><style>#probe { width: 10px } @media (prefers-contrast: more) { #probe { width: 20px } }</style><div id="probe"></div>');

    for (const scheme of ['light', 'dark']) {
      for (const more of [false, true]) {
        const session = `u478-${process.pid}-${scheme}-${more}`;
        const base = ['--session', session];

        try {
          command([...base, '--executable-path', browser, '--profile', join(directory, session), '--color-scheme', scheme,
            ...(more ? ['--args', '--force-high-contrast,--disable-features=ForcedColors'] : []),
            'open', pathToFileURL(fixture).href]);
          command([...base, 'wait', '--fn', "document.querySelector('#probe') !== null"]);

          const reading = JSON.parse(command([...base, 'eval', `JSON.stringify({
            scheme: matchMedia('(prefers-color-scheme: ${scheme})').matches,
            more: matchMedia('(prefers-contrast: more)').matches,
            forced: matchMedia('(forced-colors: active)').matches,
            width: getComputedStyle(document.querySelector('#probe')).width,
            browser: navigator.userAgent
          })`]));

          // agent-browser eval prints a JSON string for a string result.
          const actual = JSON.parse(reading);
          assert.equal(actual.scheme, true);
          assert.equal(actual.more, more);
          assert.equal(actual.forced, false);
          assert.equal(actual.width, more ? '20px' : '10px');
          console.log(JSON.stringify({ test: 'u478_native_contrast_selects_stylesheet', scheme, more, actual, exit: 0 }));
        } finally {
          command([...base, 'close']);
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
