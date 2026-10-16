// U468: this module runs inside the vendor, not an Agent's tool subprocess.
// The Daemon authenticates that program and parses TerminalAnswer at its I/O edge.
export function register(on) {
  on('classic.ElicitationResult', async ($, e, next) => {
    if (e.mcp_server_name !== 'roundup' || e.action !== 'accept') return next(e);

    const fields = Object.entries(e.content ?? {}).filter(([key]) => /^roundup_d[0-9]+$/.test(key));

    if (fields.length !== 1) return next(e);

    // Let the remaining vendor result hooks refuse before any Daemon effect.
    const policy = await next(e);

    if (policy?.block || policy?.preventContinuation) return policy;

    const [key, text] = fields[0];
    const socketPath = await $.env.get('RUPD_SOCKET');

    if (!socketPath) throw new Error('roundup question callback has no Daemon socket');

    const request = $.http.fetch('http://roundup/terminal-question/answer', {
      method: 'POST', socketPath,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: key.slice('roundup_'.length), text, note: e.content.note ?? '' }),
    });

    const deadline = $.clock.sleep(10_000, { signal: next.signal }).then(() => {
      throw new Error('Native answer outcome is unknown; do not retry.');
    });

    const response = await Promise.race([request, deadline]);

    if (!response.ok) {
      $.ui.log('The original question could not be answered: ' + response.text);

      return { block: 'The original roundup question could not be answered.' };
    }

    return policy;
  }).catch(() => ({ block: 'Native answer outcome is unknown; do not retry.' }));
}
