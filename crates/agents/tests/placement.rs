use agents::placement::{AskPart, Destination, Placement, Request, place};
use async_trait::async_trait;
use std::sync::Mutex;

struct Answer(Vec<AskPart>);
#[async_trait]
impl Placement for Answer {
    async fn call(&self, _id: &str, _request: &Request) -> Result<Vec<AskPart>, String> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn a39_an_answer_that_is_not_a_checked_span_is_unclear() {
    let request = Request::new("fix café then ship".into(), vec![], vec![]);
    for (parts, cause) in [
        (
            vec![part(
                "repair café",
                Destination::New {
                    title: "Repair".into(),
                },
            )],
            "span",
        ),
        (
            vec![part(
                "fix café",
                Destination::Routed {
                    workstream: "gone".into(),
                },
            )],
            "unknown",
        ),
        (
            vec![part(
                "fix café",
                Destination::New {
                    title: "one two three four five six seven".into(),
                },
            )],
            "title",
        ),
        (
            vec![part("fix café", Destination::New { title: "  ".into() })],
            "title",
        ),
        (
            vec![part(
                "",
                Destination::New {
                    title: "Repair".into(),
                },
            )],
            "empty",
        ),
        (
            vec![
                part(
                    "fix café",
                    Destination::New {
                        title: "Repair".into(),
                    },
                ),
                part(
                    "café",
                    Destination::New {
                        title: "Ship".into(),
                    },
                ),
            ],
            "overlap",
        ),
        (vec![], "empty"),
        (
            vec![part(
                "fix café",
                Destination::Unclear {
                    question: "Where?".into(),
                    candidates: vec!["gone".into()],
                },
            )],
            "unknown",
        ),
    ] {
        let logs = Mutex::new(vec![]);
        let result = place(&Answer(parts), "ask-39", &request, |id, cause| {
            logs.lock().unwrap().push((id.to_owned(), cause.to_owned()))
        })
        .await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "fix café then ship");
        let Destination::Unclear {
            question,
            candidates,
        } = &result[0].destination
        else {
            panic!("{result:?}")
        };
        assert!(
            question.starts_with("Couldn't place this: ") && question.contains(cause),
            "{question}"
        );
        assert!(candidates.is_empty());
        let logs = logs.lock().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].0, "ask-39");
        assert_eq!(question, &format!("Couldn't place this: {}", logs[0].1));
    }
}
fn part(text: &str, destination: Destination) -> AskPart {
    AskPart {
        text: text.into(),
        destination,
    }
}
