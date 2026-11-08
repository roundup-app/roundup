//! The Rail name an Agent takes from its first prompt.

/// What an Agent is called until its first prompt names it.
pub const UNNAMED: &str = "New Agent";

use crate::claude_code::{CONTEXT_START, LEAD_IN};

/// What a Workstream is called until its Door's first prompt names it (U6545b); `New Workstream` is
/// the stem stored Workstreams still carry.
const WORKSTREAM_STEMS: [&str; 2] = ["Workstream", "New Workstream"];

const FILLER: [&str; 11] = [
    "a", "an", "the", "to", "of", "in", "on", "for", "and", "please", "i",
];

/// U6380a: the longest a Rail name may be.
pub const MAX_CHARS: usize = 42;

/// A29: a leading `LEAD_IN` is not part of `prompt`.
/// The first three words of `prompt` that are not filler, each capitalised and joined by a space
/// (U6380a). `None` when no word is left.
pub fn from_prompt(prompt: &str) -> Option<String> {
    let prompt = prompt.strip_prefix(LEAD_IN).unwrap_or(prompt);
    let prompt = prompt
        .split_once(CONTEXT_START)
        .map_or(prompt, |(work, _)| work);
    let lower = task_text(&strip_tags(prompt)).to_lowercase();
    let words: Vec<String> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !FILLER.contains(word))
        .take(3)
        .map(capitalise)
        .collect();
    let joined: String = words.join(" ").chars().take(MAX_CHARS).collect();
    let name = joined.trim_end();
    (!name.is_empty()).then(|| name.to_owned())
}

/// U6380a: `text` without the tokens that are not task words: one starting with `/` or `@`, one
/// holding `://`, and an `[Image #N]` placeholder.
fn task_text(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("[Image #") {
        let after = &rest[at + "[Image #".len()..];
        let digits = after.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && after[digits..].starts_with(']') {
            plain.push_str(&rest[..at]);
            plain.push(' ');
            rest = &after[digits + 1..];
        } else {
            plain.push_str(&rest[..at + 1]);
            rest = &rest[at + 1..];
        }
    }
    plain.push_str(rest);
    plain
        .split_whitespace()
        .filter(|token| !token.starts_with(['/', '@']) && !token.contains("://"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// A9: the Rail name Claude Code's own session title gives: each word's first letter upper-cased
/// and the rest kept, cut to 42 characters. `None` when the title holds no word.
pub fn from_title(title: &str) -> Option<String> {
    let joined: String = title
        .split_whitespace()
        .map(capitalise)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_CHARS)
        .collect();
    let name = joined.trim_end();
    (!name.is_empty()).then(|| name.to_owned())
}

/// U6380b: whether `name` is a Workstream's placeholder, `Workstream` or `Workstream 2`…, or the
/// older `New Workstream` or `New Workstream 2`…
pub fn is_workstream_placeholder(name: &str) -> bool {
    WORKSTREAM_STEMS.iter().any(|stem| {
        name.strip_prefix(stem).is_some_and(|rest| {
            rest.is_empty()
                || rest
                    .strip_prefix(' ')
                    .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        })
    })
}

fn capitalise(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// A27: `text` without its tags. A `<` followed by a letter, `/` or `!` opens a tag that ends at the
/// next `>`, or at the end of `text`; any other `<` is text.
fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        if after.starts_with(|c: char| c.is_alphabetic() || c == '/' || c == '!') {
            // A tag is replaced by a space so the words around it stay apart.
            out.push(' ');
            rest = after.find('>').map_or("", |end| &after[end + 1..]);
        } else {
            out.push('<');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// A28: the name a spawning Agent gave its child, trimmed; `Err` says why it is not a name.
pub fn given(name: &str) -> Result<String, &'static str> {
    let name = name.trim();
    if name.is_empty() {
        Err("name is empty")
    } else if name.chars().count() > MAX_CHARS {
        Err("name is longer than 42 characters")
    } else if name.chars().any(char::is_control) {
        Err("name holds a control character")
    } else {
        Ok(name.to_owned())
    }
}

/// U176: the first of `name`, `name 2`, `name 3`, … that is not in `taken`. `name` is cut so the
/// whole stays within 42 characters.
pub fn unique<'a>(name: &str, taken: impl IntoIterator<Item = &'a str>) -> String {
    let taken: Vec<&str> = taken.into_iter().collect();
    if !taken.contains(&name) {
        return name.to_owned();
    }
    let mut n = 2;
    loop {
        let suffix = format!(" {n}");
        let stem: String = name.chars().take(MAX_CHARS - suffix.len()).collect();
        let candidate = format!("{}{suffix}", stem.trim_end());
        if !taken.contains(&candidate.as_str()) {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{from_prompt, from_title, given, unique};
    use crate::claude_code::LEAD_IN;

    #[test]
    fn a9_commands_mentions_links_and_image_placeholders_are_not_words() {
        assert_eq!(
            from_prompt("/compose /intent I would like to get the printer working").as_deref(),
            Some("Would Like Get")
        );
        assert_eq!(
            from_prompt("[Image #1] @src/a.ts https://x.y/z fix the race").as_deref(),
            Some("Fix Race")
        );
    }

    #[test]
    fn a9_a_title_keeps_its_letters_and_is_cut_to_42() {
        assert_eq!(
            from_title("Printing public MakerWorld models").as_deref(),
            Some("Printing Public MakerWorld Models")
        );
        let cut = from_title(&format!("{} b", "a".repeat(41))).unwrap();
        assert_eq!(cut.chars().count(), 41);
        assert_eq!(from_title("  "), None);
    }

    #[test]
    fn a27_a_tag_and_its_attribute_are_not_words() {
        assert_eq!(
            from_prompt(r#"<pasted_content id="x">Fix the refresh race</pasted_content>"#)
                .as_deref(),
            Some("Fix Refresh Race")
        );
    }

    #[test]
    fn a27_only_a_tag_keeps_the_current_name() {
        assert_eq!(from_prompt(r#"<pasted_content id="x">"#), None);
    }

    #[test]
    fn a27_an_unclosed_tag_leaves_no_words() {
        assert_eq!(from_prompt(r#"<pasted_content id="x" fix the race"#), None);
    }

    #[test]
    fn a27_a_lone_less_than_is_text() {
        assert_eq!(from_prompt("a < b and c").as_deref(), Some("B C"));
        assert_eq!(from_prompt("x <3 y =< z").as_deref(), Some("X 3 Y"));
    }

    #[test]
    fn a28_given_names_are_trimmed_and_checked() {
        assert_eq!(given("  fix race ").as_deref(), Ok("fix race"));
        assert!(given("  ").is_err());
        assert!(given(&"a".repeat(43)).is_err());
        assert!(given("a\nb").is_err());
        assert!(given(&"a".repeat(42)).is_ok());
    }

    #[test]
    fn u176_three_siblings_with_one_prompt_get_three_names() {
        let mut taken: Vec<String> = Vec::new();
        for _ in 0..3 {
            let name = unique("What Should This", taken.iter().map(String::as_str));
            taken.push(name);
        }
        assert_eq!(
            taken,
            [
                "What Should This",
                "What Should This 2",
                "What Should This 3"
            ]
        );
    }

    #[test]
    fn u176_a_renamed_sibling_frees_its_name() {
        let taken = ["X", "renamed", "X 3"];
        assert_eq!(unique("X", taken), "X 2");
        assert_eq!(unique("Y", taken), "Y");
    }

    #[test]
    fn u176_a_42_character_name_gets_its_suffix_within_42_characters() {
        let long = "a".repeat(42);
        let second = unique(&long, [long.as_str()]);
        assert_eq!(second, format!("{} 2", "a".repeat(40)));
        let third = unique(&long, [long.as_str(), second.as_str()]);
        assert_eq!(third, format!("{} 3", "a".repeat(40)));
        assert_eq!(third.chars().count(), 42);
    }

    #[test]
    fn a9_filler_and_punctuation_drop_out_and_three_words_remain() {
        assert_eq!(
            from_prompt("Fix the refresh race in token.ts").as_deref(),
            Some("Fix Refresh Race")
        );
    }

    #[test]
    fn a9_every_filler_word_is_dropped() {
        let all = "a an the to of in on for and please fix build";
        assert_eq!(from_prompt(all).as_deref(), Some("Fix Build"));
        for word in [
            "a", "an", "the", "to", "of", "in", "on", "for", "and", "please",
        ] {
            assert_eq!(
                from_prompt(&format!("{word} fix {word}")).as_deref(),
                Some("Fix"),
                "{word}"
            );
        }
    }

    #[test]
    fn a9_a_long_name_is_cut_at_42_characters_without_a_trailing_space() {
        let name = from_prompt("internationalisation free ABCDEFGHIJKLMNOPQRSTUVWXYZ").unwrap();
        assert_eq!(name, "Internationalisation Free Abcdefghijklmnop");
        let cut_at_a_space =
            from_prompt("abcdefghijklmnopqrstuvwxyzabcdefghijklmno next word").unwrap();
        assert_eq!(cut_at_a_space, "Abcdefghijklmnopqrstuvwxyzabcdefghijklmno");
    }

    #[test]
    fn a9_words_are_unicode_letters_and_digits() {
        assert_eq!(
            from_prompt("Über 2nd Straße!").as_deref(),
            Some("Über 2nd Straße")
        );
    }

    #[test]
    fn a9_a_prompt_with_no_words_left_has_no_name() {
        assert_eq!(from_prompt("Please, the... of!"), None);
        assert_eq!(from_prompt(""), None);
    }

    #[test]
    fn a29_a_leading_lead_in_is_not_a_word() {
        let prompt = format!("{LEAD_IN}Reply with the single word ready");
        assert_eq!(from_prompt(&prompt).as_deref(), Some("Reply With Single"));
    }

    #[test]
    fn a29_a_lead_in_before_a_tag_gives_the_text_name() {
        let prompt =
            format!("{LEAD_IN}<pasted_content id=\"x\">Fix the refresh race</pasted_content>");
        assert_eq!(from_prompt(&prompt).as_deref(), Some("Fix Refresh Race"));
    }

    #[test]
    fn a29_only_a_lead_in_keeps_the_current_name() {
        assert_eq!(from_prompt(LEAD_IN), None);
    }

    #[test]
    fn a29_a_lead_in_in_the_middle_is_text() {
        let prompt = format!("Fix the refresh race. {LEAD_IN}now");
        assert_eq!(from_prompt(&prompt).as_deref(), Some("Fix Refresh Race"));
    }
}
