/** U5561, U7312a: a fold opens with `<details><summary>Label</summary>` on its own line and closes with `</details>` on its own line. */
export const foldOpening = /^<details>\s*<summary>([^\r\n]*)<\/summary>\s*$/;

export const foldClosing = /^<\/details>\s*$/;
