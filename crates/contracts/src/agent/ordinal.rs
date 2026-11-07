//! `Ordinal`: the positive decimal behind an Attempt or a Status revision.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Parse the wire ordinal without accepting aliases such as leading zeroes or signs.
fn parse_positive_ordinal(value: &str) -> Option<i64> {
    value
        .parse::<i64>()
        .ok()
        .filter(|n| *n > 0 && n.to_string() == value)
}

/// A positive decimal count (an Attempt or a Status revision), a string on the wire.
/// A malformed value fails at deserialize.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Type, JsonSchema)]
#[serde(try_from = "String", into = "String")]
#[specta(type = String)]
#[schemars(with = "String")]
pub struct Ordinal {
    // The decimal text, inline: a Rail of forty Workstreams must not allocate per node (R3696c).
    digits: [u8; 19],
    len: u8,
}

impl Ordinal {
    /// `None` unless `n` is positive.
    pub fn new(n: i64) -> Option<Self> {
        (n > 0).then(|| Self::of(n))
    }

    /// Parse the wire form; `None` for `0`, `01`, a sign, a space or a non-number.
    pub fn parse(value: &str) -> Option<Self> {
        parse_positive_ordinal(value).map(Self::of)
    }

    /// The first Attempt or Status revision.
    pub fn first() -> Self {
        Self::of(1)
    }

    /// `n` is positive, so it has at most 19 digits.
    fn of(n: i64) -> Self {
        let mut digits = [0; 19];
        let mut len = 0;
        let mut rest = n;
        while rest > 0 {
            len += 1;
            rest /= 10;
        }
        rest = n;
        for slot in digits.iter_mut().take(len).rev() {
            *slot = b'0' + (rest % 10) as u8;
            rest /= 10;
        }
        Self {
            digits,
            len: len as u8,
        }
    }

    /// The ordinal after this one; `None` past `i64::MAX`.
    pub fn next(&self) -> Option<Self> {
        self.get().checked_add(1).and_then(Self::new)
    }

    pub fn as_str(&self) -> &str {
        self.digits
            .get(..usize::from(self.len))
            .and_then(|digits| std::str::from_utf8(digits).ok())
            .unwrap_or_default()
    }

    pub fn get(&self) -> i64 {
        self.as_str().parse().unwrap_or_default()
    }
}

// More digits is a larger number, and equal lengths compare as text.
impl Ord for Ordinal {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.len, self.digits).cmp(&(other.len, other.digits))
    }
}

impl PartialOrd for Ordinal {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl TryFrom<String> for Ordinal {
    type Error = String;

    fn try_from(value: String) -> Result<Self, String> {
        Self::parse(&value).ok_or_else(|| format!("invalid ordinal {value:?}"))
    }
}

impl From<Ordinal> for String {
    fn from(value: Ordinal) -> String {
        value.as_str().to_owned()
    }
}

macro_rules! ordinal_eq {
    ($($other:ty),*) => {$(
        impl PartialEq<$other> for Ordinal {
            fn eq(&self, other: &$other) -> bool {
                *self.as_str() == **other
            }
        }
        impl PartialEq<Ordinal> for $other {
            fn eq(&self, other: &Ordinal) -> bool {
                *other.as_str() == **self
            }
        }
    )*};
}
ordinal_eq!(&str, String);

impl std::ops::Deref for Ordinal {
    type Target = str;

    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl std::fmt::Display for Ordinal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
