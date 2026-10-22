//! LK4, T27: a link to a Pad or one of its sections, `roundup://pad/<name>?project=<key>#<heading>`.

use percent_encoding::percent_decode_str;

use crate::section;

pub struct PadRef {
    pub project: String,
    pub name: String,
    /// The heading as the link spells it, if the link names a section.
    pub heading: Option<String>,
}

impl PadRef {
    /// Equal for two links that name the same Pad and the same section.
    pub fn target(&self) -> String {
        match &self.heading {
            Some(heading) => format!("{}#{}", self.name, section::wanted(heading)),
            None => self.name.clone(),
        }
    }
}

/// Why `url` is no Pad link of the shape LK1 and LK4 describe.
pub fn parse(url: &str) -> Result<PadRef, String> {
    let url = url::Url::parse(url).map_err(|err| format!("the URL does not parse ({err})"))?;
    if url.scheme() != "roundup" || url.host_str() != Some("pad") {
        return Err("it is not a roundup://pad/ link".into());
    }
    let path = url.path().strip_prefix('/').unwrap_or_default();
    if path.is_empty() || path.contains('/') {
        return Err("the path is not exactly one Pad name".into());
    }
    let decode = |text: &str| {
        percent_decode_str(text)
            .decode_utf8()
            .map(|text| text.into_owned())
            .map_err(|_| "a part is not UTF-8".to_string())
    };
    let mut project = None;
    for (name, value) in url.query_pairs() {
        if name != "project" || project.replace(value.into_owned()).is_some() {
            return Err("the query is not exactly one `project`".into());
        }
    }
    let heading = url.fragment().map(decode).transpose()?;
    if heading
        .as_deref()
        .is_some_and(|h| section::wanted(h).is_empty())
    {
        return Err("the fragment names no heading".into());
    }
    Ok(PadRef {
        project: project
            .filter(|key| !key.is_empty())
            .ok_or("the `project` parameter is missing")?,
        name: decode(path)?,
        heading,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lk4_one_section_has_one_target() {
        let one = parse("roundup://pad/notes?project=k#Plan").unwrap();
        let two = parse("roundup://pad/notes?project=k#%20plan").unwrap();
        assert_eq!(one.target(), two.target());
        assert_ne!(
            one.target(),
            parse("roundup://pad/notes?project=k").unwrap().target()
        );
    }
}
