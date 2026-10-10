//! The Rail name an Agent takes from its first prompt.

/// What an Agent is called until its first prompt names it.
pub const UNNAMED: &str = "new-agent";

use crate::claude_code::LEAD_IN;

const FILLER: [&str; 10] = [
    "a", "an", "the", "to", "of", "in", "on", "for", "and", "please",
];

const MAX_CHARS: usize = 32;

/// A29: a leading `LEAD_IN` is not part of `prompt`.
/// The first three words of `prompt` that are not filler, lower-cased and joined by `-`. `None`
/// when no word is left.
pub fn from_prompt(prompt: &str) -> Option<String> {
    let prompt = prompt.strip_prefix(LEAD_IN).unwrap_or(prompt);
    let lower = strip_tags(prompt).to_lowercase();
    let words: Vec<_> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !FILLER.contains(word))
        .take(3)
        .collect();
    let joined: String = words.join("-").chars().take(MAX_CHARS).collect();
    let name = joined.trim_end_matches('-');
    (!name.is_empty()).then(|| name.to_owned())
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
        Err("name is longer than 32 characters")
    } else if name.chars().any(char::is_control) {
        Err("name holds a control character")
    } else {
        Ok(name.to_owned())
    }
}

/// U176: the first of `name`, `name-2`, `name-3`, … that is not in `taken`. `name` is cut so the
/// whole stays within 32 characters.
pub fn unique<'a>(name: &str, taken: impl IntoIterator<Item = &'a str>) -> String {
    let taken: Vec<&str> = taken.into_iter().collect();
    if !taken.contains(&name) {
        return name.to_owned();
    }
    (2..)
        .map(|n| {
            let suffix = format!("-{n}");
            let stem: String = name.chars().take(MAX_CHARS - suffix.len()).collect();
            format!("{}{suffix}", stem.trim_end_matches('-'))
        })
        .find(|candidate| !taken.contains(&candidate.as_str()))
        .expect("an unbounded range always yields a free name")
}

#[cfg(test)]
mod tests {
    use super::{from_prompt, given, unique};
    use crate::claude_code::LEAD_IN;

    #[test]
    fn a27_a_tag_and_its_attribute_are_not_words() {
        assert_eq!(
            from_prompt(r#"<pasted_content id="x">Fix the refresh race</pasted_content>"#)
                .as_deref(),
            Some("fix-refresh-race")
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
        assert_eq!(from_prompt("a < b and c").as_deref(), Some("b-c"));
        assert_eq!(from_prompt("x <3 y =< z").as_deref(), Some("x-3-y"));
    }

    #[test]
    fn a28_given_names_are_trimmed_and_checked() {
        assert_eq!(given("  fix race ").as_deref(), Ok("fix race"));
        assert!(given("  ").is_err());
        assert!(given(&"a".repeat(33)).is_err());
        assert!(given("a\nb").is_err());
        assert!(given(&"a".repeat(32)).is_ok());
    }

    #[test]
    fn u176_three_siblings_with_one_prompt_get_three_names() {
        let mut taken: Vec<String> = Vec::new();
        for _ in 0..3 {
            let name = unique("what-should-this", taken.iter().map(String::as_str));
            taken.push(name);
        }
        assert_eq!(
            taken,
            [
                "what-should-this",
                "what-should-this-2",
                "what-should-this-3"
            ]
        );
    }

    #[test]
    fn u176_a_renamed_sibling_frees_its_name() {
        let taken = ["x", "renamed", "x-3"];
        assert_eq!(unique("x", taken), "x-2");
        assert_eq!(unique("y", taken), "y");
    }

    #[test]
    fn u176_a_32_character_name_gets_its_suffix_within_32_characters() {
        let long = "a".repeat(32);
        let second = unique(&long, [long.as_str()]);
        assert_eq!(second, format!("{}-2", "a".repeat(30)));
        let third = unique(&long, [long.as_str(), second.as_str()]);
        assert_eq!(third, format!("{}-3", "a".repeat(30)));
        assert_eq!(third.chars().count(), 32);
    }

    #[test]
    fn a9_filler_and_punctuation_drop_out_and_three_words_remain() {
        assert_eq!(
            from_prompt("Fix the refresh race in token.ts").as_deref(),
            Some("fix-refresh-race")
        );
    }

    #[test]
    fn a9_every_filler_word_is_dropped() {
        let all = "a an the to of in on for and please fix build";
        assert_eq!(from_prompt(all).as_deref(), Some("fix-build"));
        for word in [
            "a", "an", "the", "to", "of", "in", "on", "for", "and", "please",
        ] {
            assert_eq!(
                from_prompt(&format!("{word} fix {word}")).as_deref(),
                Some("fix"),
                "{word}"
            );
        }
    }

    #[test]
    fn a9_a_long_name_is_cut_at_32_characters_without_a_trailing_dash() {
        let name = from_prompt("internationalisation-free ABCDEFGHIJKLMNOPQRSTUVWXYZ").unwrap();
        assert_eq!(name, "internationalisation-free-abcdef");
        let cut_at_a_dash = from_prompt("abcdefghijklmnopqrstuvwxyzabcde next word").unwrap();
        assert_eq!(cut_at_a_dash, "abcdefghijklmnopqrstuvwxyzabcde");
    }

    #[test]
    fn a9_words_are_unicode_letters_and_digits() {
        assert_eq!(
            from_prompt("Über 2nd Straße!").as_deref(),
            Some("über-2nd-straße")
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
        assert_eq!(from_prompt(&prompt).as_deref(), Some("reply-with-single"));
    }

    #[test]
    fn a29_a_lead_in_before_a_tag_gives_the_text_name() {
        let prompt =
            format!("{LEAD_IN}<pasted_content id=\"x\">Fix the refresh race</pasted_content>");
        assert_eq!(from_prompt(&prompt).as_deref(), Some("fix-refresh-race"));
    }

    #[test]
    fn a29_only_a_lead_in_keeps_the_current_name() {
        assert_eq!(from_prompt(LEAD_IN), None);
    }

    #[test]
    fn a29_a_lead_in_in_the_middle_is_text() {
        let prompt = format!("Fix the refresh race. {LEAD_IN}now");
        assert_eq!(from_prompt(&prompt).as_deref(), Some("fix-refresh-race"));
    }
}
