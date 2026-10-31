use super::*;

pub(super) struct ScreenState {
    pub(super) parser: ScreenParser,
    pub(super) after: u64,
    /// X13: the last megabyte of output; its end is `after`.
    pub(super) log: output::Log,
    /// X16: where each reader's next `terminal.read` begins; it ends with the Terminal.
    pub(super) cursors: std::collections::HashMap<String, u64>,
    pub(super) snapshot_available: bool,
    pub(super) scrollback_rows: usize,
    pub(super) cols: u16,
    pub(super) rows: u16,
    /// X17: the program turned on mode 2031 and gets a notice when the scheme changes.
    pub(super) scheme_notices: bool,
    /// PS1–PS6: the records the program's reports made.
    pub(super) status: status::Mirror,
}

pub(super) enum ScreenParser {
    Pending,
    Active(Box<vt100::Parser<Seen>>),
    Failed,
}

impl ScreenState {
    pub(super) fn ensure_parser(&mut self) -> Option<&mut vt100::Parser<Seen>> {
        if matches!(&self.parser, ScreenParser::Pending) {
            let (rows, cols, scrollback) = if self.snapshot_available {
                (self.rows, self.cols, self.scrollback_rows)
            } else {
                (TITLE_ROWS, TITLE_COLS, 0)
            };
            self.parser = ScreenParser::Active(Box::new(vt100::Parser::new_with_callbacks(
                rows,
                cols,
                scrollback,
                Seen::default(),
            )));
        }
        match &mut self.parser {
            ScreenParser::Active(parser) => Some(parser),
            ScreenParser::Pending | ScreenParser::Failed => None,
        }
    }
}

/// State shared with each Terminal's reader thread.
#[derive(Default)]
pub(super) struct Seen {
    pub(super) titles: Vec<String>,
    pub(super) requests: Vec<scheme::Request>,
}

impl vt100::Callbacks for Seen {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.titles
            .push(String::from_utf8_lossy(title).into_owned());
    }

    fn unhandled_csi(
        &mut self,
        _: &mut vt100::Screen,
        first: Option<u8>,
        second: Option<u8>,
        params: &[&[u16]],
        last: char,
    ) {
        self.requests
            .extend(scheme::from_csi(first, second, params, last));
    }

    /// vt100 splits an OSC on every `;` and only reports a title that is a single piece, so a
    /// title containing `;` arrives here and would otherwise be dropped.
    fn unhandled_osc(&mut self, _: &mut vt100::Screen, params: &[&[u8]]) {
        if let [b"0" | b"2", pieces @ ..] = params {
            self.titles
                .push(String::from_utf8_lossy(&pieces.join(&b';')).into_owned());
        }
        self.requests.extend(scheme::from_osc(params));
    }
}

pub(super) fn formatted_snapshot(screen: &vt100::Screen) -> Result<Vec<u8>, RpcError> {
    let visible = screen.state_formatted();
    let alternate = screen.alternate_screen();
    let prefix = if alternate {
        b"\x1b[?1049h".as_slice()
    } else {
        &[]
    };
    if prefix.len() + visible.len() > SNAPSHOT_MAX_BYTES {
        return Err(RpcError::conflict(
            "terminal visible screen exceeds snapshot limit",
        ));
    }

    let mut history = Vec::new();
    if !alternate {
        let mut prior = screen.clone();
        prior.set_scrollback(SNAPSHOT_SCROLLBACK);
        let count = prior.scrollback();
        let (_, cols) = prior.size();
        for offset in (1..=count).rev() {
            prior.set_scrollback(offset);
            let row = prior.rows(0, cols).next().unwrap_or_default();
            let mut line = row.into_bytes();
            line.extend_from_slice(b"\r\n");
            history.push(line);
        }
    }
    let mut total = prefix.len() + visible.len() + history.iter().map(Vec::len).sum::<usize>();
    while total > SNAPSHOT_MAX_BYTES {
        total -= history.remove(0).len();
    }
    let mut data = Vec::with_capacity(total);
    data.extend_from_slice(prefix);
    for line in history {
        data.extend_from_slice(&line);
    }
    data.extend_from_slice(&visible);
    Ok(data)
}

pub(super) fn snapshot_size_supported(cols: u16, rows: u16) -> bool {
    u32::from(cols) * u32::from(rows) <= SNAPSHOT_MAX_CELLS
}

impl Terminals {
    /// Z3788a: bounded raw output for the original Terminal, at one authoritative cut.
    pub fn catch_up(
        &self,
        params: &contracts::terminal::CatchUpParams,
    ) -> Result<contracts::terminal::CatchUp, RpcError> {
        use contracts::terminal::CatchUp;
        if let Some(remote) = self.remote(&params.id)? {
            return remote.call(
                "terminal.catchUp",
                serde_json::to_value(params).map_err(RpcError::internal)?,
            );
        }
        let number = parse_terminal_number(&params.id)?;
        let table = self.shared.table();
        let entry = table
            .get(&number)
            .ok_or_else(|| RpcError::not_found(format!("terminal {}", params.id)))?;
        if entry.info.incarnation != params.incarnation {
            return Err(RpcError::conflict(
                "original Terminal is no longer available in this Project",
            ));
        }
        let state = entry.screen.lock().expect("terminal screen lock");
        let data = state.log.raw(params.after)?;
        let id = entry.info.id.clone();
        let incarnation = entry.info.incarnation.clone();
        let after = state.log.end();
        if params.after < state.log.start() {
            return Ok(CatchUp::Gap {
                id,
                incarnation,
                from: state.log.start(),
                after,
            });
        }
        Ok(CatchUp::Contiguous {
            id,
            incarnation,
            from: params.after,
            after,
            data: STANDARD.encode(data),
        })
    }
}
