//! U5959: the platform-free description of a native menu row.

/// The Kind Glyph tones of `apps/desktop/src/ink/glyph.ts` (`tokens.css`, `--amber`, `--red`, `--accent`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Amber,
    Red,
    Accent,
}

impl Tone {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn srgb(self, dark: bool) -> (f64, f64, f64) {
        let hex: u32 = match (self, dark) {
            (Self::Amber, false) => 0xab6400,
            (Self::Amber, true) => 0xffca16,
            (Self::Red, false) => 0xce2c31,
            (Self::Red, true) => 0xff9592,
            (Self::Accent, false) => 0x1a6b61,
            (Self::Accent, true) => 0x5cc7b5,
        };
        let channel = |shift: u32| f64::from((hex >> shift) & 0xff) / 255.0;
        (channel(16), channel(8), channel(0))
    }
}

/// How one native row looks; the index matches the Muda item at the same position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Look {
    Plain,
    /// A grey system section header.
    Head,
    Agent {
        subtitle: String,
        badge: Option<String>,
        symbol: &'static str,
        tone: Tone,
    },
}
