use super::{Settings, State};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct View {
    pub seq: u64,
    pub at_ms: f64,
    pub cause: String,
    pub visibility: String,
    pub focused: bool,
    pub project: Option<String>,
    pub terminal: Option<String>,
    pub renderer: Option<String>,
    pub width: u64,
    pub height: u64,
}
#[derive(Clone, Debug, Deserialize)]
struct Native {
    focused: bool,
    visible: bool,
    minimized: bool,
    width: u64,
    height: u64,
    scale: f64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "source", content = "body")]
enum Event {
    #[serde(rename = "start")]
    Start { pid: u32 },
    #[serde(rename = "native")]
    Native(Native),
    #[serde(rename = "application")]
    Application { hidden: bool },
    #[serde(rename = "window-event")]
    Window {
        focused: Option<bool>,
        width: Option<u64>,
        height: Option<u64>,
        scale: Option<f64>,
    },
    #[serde(rename = "webview")]
    Webview(View),
    #[serde(rename = "checkpoint")]
    Checkpoint { web_seq: u64 },
    #[serde(rename = "end")]
    End(String),
    #[serde(rename = "error")]
    Error(String),
}
#[derive(Clone, Debug, Deserialize)]
struct Row {
    v: u8,
    seq: u64,
    at_us: u64,
    #[serde(flatten)]
    event: Event,
}
#[derive(Default)]
pub struct Journal {
    rows: Vec<Row>,
    origin_upper_s: f64,
    web_seq: u64,
    web_time: f64,
}

impl Journal {
    /// Complete snapshots only; a final partial line is always loss. Receipt upper bound
    /// keeps launch, producer and renderer clock origins distinct.
    pub fn parse(
        raw: &str,
        first_receipt_s: f64,
        pid: u32,
        complete: bool,
    ) -> Result<Self, String> {
        if !first_receipt_s.is_finite() || first_receipt_s < 0.0 || !raw.ends_with('\n') {
            return Err("missing/partial App evidence".into());
        }
        let mut journal = Self {
            origin_upper_s: first_receipt_s,
            ..Self::default()
        };
        let mut last = 0;
        let mut checkpoint = false;
        for (index, line) in raw.lines().enumerate() {
            let row: Row = serde_json::from_str(line)
                .map_err(|e| format!("App evidence row {}: {e}", index + 1))?;
            if row.v != 1
                || row.seq != index as u64 + 1
                || row.at_us < last
                || matches!(journal.rows.last().map(|r| &r.event), Some(Event::End(_)))
            {
                return Err("App evidence sequence/time loss".into());
            }
            if index == 0 && !matches!(row.event, Event::Start { pid: owner } if owner == pid) {
                return Err("missing/mismatched App start identity".into());
            }
            match &row.event {
                Event::Start { .. } if index != 0 => return Err("App evidence restarted".into()),
                Event::Error(e) => return Err(format!("App collection error: {e}")),
                Event::Webview(v) => {
                    if checkpoint {
                        return Err("renderer event after final checkpoint".into());
                    }
                    if v.seq != journal.web_seq + 1
                        || !v.at_ms.is_finite()
                        || v.at_ms < journal.web_time
                        || v.cause == "collection-lost"
                        || !["visible", "hidden"].contains(&v.visibility.as_str())
                    {
                        return Err(
                            "renderer collection lost/invalid sequence/time/visibility".into()
                        );
                    }
                    journal.web_seq = v.seq;
                    journal.web_time = v.at_ms;
                }
                Event::Checkpoint { web_seq } => {
                    if *web_seq == 0 || *web_seq != journal.web_seq {
                        return Err("incomplete renderer checkpoint".into());
                    }
                    checkpoint = true;
                }
                Event::End(_) if !checkpoint => {
                    return Err("end without renderer checkpoint".into());
                }
                Event::End(text) if text.is_empty() => {
                    return Err("missing App exit evidence".into());
                }
                _ => (),
            }
            last = row.at_us;
            journal.rows.push(row);
        }
        if journal.rows.is_empty()
            || !journal
                .rows
                .iter()
                .any(|r| matches!(r.event, Event::Native(_)))
            || !journal
                .rows
                .iter()
                .any(|r| matches!(r.event, Event::Application { .. }))
            || journal.web_seq == 0
        {
            return Err("missing initial native/application/webview snapshot".into());
        }
        if complete && !matches!(journal.rows.last().map(|r| &r.event), Some(Event::End(_))) {
            return Err("missing final checkpoint/end".into());
        }
        Ok(journal)
    }

    pub fn geometry(&self) -> Option<(u64, u64, f64)> {
        self.rows.iter().rev().find_map(|r| {
            if let Event::Native(n) = &r.event {
                Some((n.width, n.height, n.scale))
            } else {
                None
            }
        })
    }
    pub fn latest(&self) -> Option<&View> {
        self.rows.iter().rev().find_map(|r| {
            if let Event::Webview(v) = &r.event {
                Some(v)
            } else {
                None
            }
        })
    }

    /// Every possible event time that intersects the stable interval is inspected,
    /// including renderer events delivered only after unhide. Ambiguity refuses a pass.
    pub fn phase(
        &self,
        state: State,
        start_s: f64,
        end_s: f64,
        settings: &Settings,
    ) -> Result<(), String> {
        if !start_s.is_finite() || !end_s.is_finite() || end_s <= start_s {
            return Err("invalid phase time".into());
        }
        let mut native = None;
        let mut hidden = None;
        let mut view = None;
        for row in &self.rows {
            let receipt_low = row.at_us as f64 / 1_000_000.0;
            let upper = receipt_low + self.origin_upper_s;
            // performance.now() starts after process launch, so it is a conservative lower bound.
            let lower = if let Event::Webview(v) = &row.event {
                (v.at_ms / 1000.0).min(receipt_low)
            } else {
                receipt_low
            };
            if lower > end_s {
                continue;
            }
            match &row.event {
                Event::Native(v) => native = Some(v.clone()),
                Event::Application { hidden: h } => hidden = Some(*h),
                Event::Webview(v) => view = Some(v),
                Event::Window {
                    focused,
                    width,
                    height,
                    scale,
                } => {
                    if let Some(n) = native.as_mut() {
                        if let Some(f) = focused {
                            n.focused = *f;
                        }
                        if let Some(w) = width {
                            n.width = *w;
                        }
                        if let Some(h) = height {
                            n.height = *h;
                        }
                        if let Some(s) = scale {
                            n.scale = *s;
                        }
                    }
                }
                _ => (),
            }
            if upper >= start_s {
                check(state, native.as_ref(), hidden, view, settings)?;
            }
        }
        check(state, native.as_ref(), hidden, view, settings)
    }
}
fn check(
    state: State,
    native: Option<&Native>,
    hidden: Option<bool>,
    view: Option<&View>,
    settings: &Settings,
) -> Result<(), String> {
    let (Some(n), Some(h), Some(v)) = (native, hidden, view) else {
        return Err("missing visibility evidence".into());
    };
    let valid = match state {
        State::Focused => n.focused && n.visible && !h && v.focused && v.visibility == "visible",
        State::Unfocused => {
            !n.focused && n.visible && !h && !v.focused && v.visibility == "visible"
        }
        State::Hidden => !n.focused && h && !v.focused,
    };
    // Hidden document state is recorded as observed; WebKit may keep it visible.
    if !valid
        || n.minimized
        || n.width != settings.physical_width
        || n.height != settings.physical_height
        || n.scale != settings.scale
        || !n.scale.is_finite()
        || n.scale <= 0.0
    {
        return Err(format!("invalid native/webview visibility for {state:?}"));
    }
    if v.project.as_deref() != Some(&settings.project)
        || v.terminal.as_deref() != Some(&settings.terminal)
        || v.renderer.as_deref() != Some(&settings.renderer)
        || v.width != settings.width
        || v.height != settings.height
    {
        return Err("selected Terminal/renderer/window changed".into());
    }
    Ok(())
}
