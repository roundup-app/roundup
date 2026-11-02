"""L23: how a Codex run signs in: the ChatGPT login of the secret `CODEX_AUTH_JSON`, or the OpenAI API key of `OPENAI_API_KEY`."""
import json
import os
from pathlib import Path

import image_tools


def home(login, key, directory):
    """Make `directory` a Codex home outside the checkout, so no commit takes it, and return it. With the API `key` the run
    reads it from `CODEX_API_KEY` (`env`), which `codex exec` honours over any stored login, and the home holds no login;
    otherwise `login` must be a ChatGPT login, written to the home's `auth.json`. Raises ValueError for neither."""
    if key:
        print(f'::add-mask::{key}')
    else:
        auth = json.loads(login or '{}')
        if auth.get('auth_mode') != 'chatgpt' or not auth.get('tokens'):
            raise ValueError('CODEX_AUTH holds no ChatGPT login: seed the CODEX_AUTH_JSON secret with `codex login`')
        # GitHub masks the whole secret, not each token inside it.
        for value in auth['tokens'].values():
            print(f'::add-mask::{value}')
    directory.mkdir(mode=0o700, exist_ok=True)
    if not key:
        (directory / 'auth.json').write_text(login)
    memory = '\n[features]\nmemories = true\n\n[memories]\ngenerate_memories = true\nuse_memories = true\n' if os.environ.get('ROUNDUP_AGENT_MEMORY') else ''
    (directory / 'config.toml').write_text('cli_auth_credentials_store = "file"\n' + memory + image_tools.codex_files(directory))
    return directory


def env(key):
    """The environment variable that signs `codex exec` in with the API `key`: none for no key."""
    return {'CODEX_API_KEY': key} if key else {}
