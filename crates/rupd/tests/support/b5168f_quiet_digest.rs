//! B5168f: a new question starts one turn. The quiet-digest cases are in `inbox_repeats`.
use super::*;

#[tokio::test]
async fn b5168f_a_new_question_starts_one_turn() {
    let mut run = Run::start().await;
    run.kind = "question";
    let id = run.note("which branch?").await;
    until("taken up", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
}
