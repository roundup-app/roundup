use specta::datatype::{DataType, Fields};

// Serde defaults and catch-all variants widen accepted inputs; TS retains output shapes.
// The pinned specta-serde format has no switch to retain explicit optionality.
pub(crate) fn defaults(ty: &mut DataType) {
    match ty {
        DataType::Struct(s) => {
            s.attributes.remove("serde:container:default");
            fields(&mut s.fields);
        }
        DataType::Enum(e) => {
            for (_, v) in &mut e.variants {
                v.attributes.remove("serde:variant:other");
                fields(&mut v.fields);
            }
        }
        DataType::List(l) => defaults(&mut l.ty),
        DataType::Map(m) => {
            defaults(m.key_ty_mut());
            defaults(m.value_ty_mut());
        }
        DataType::Tuple(t) => {
            for ty in &mut t.elements {
                defaults(ty);
            }
        }
        DataType::Intersection(types) => {
            for ty in types {
                defaults(ty);
            }
        }
        DataType::Nullable(ty) => defaults(ty),
        _ => {}
    }
}
fn fields(fields: &mut Fields) {
    let fields: Vec<_> = match fields {
        Fields::Named(fields) => fields.fields.iter_mut().map(|(_, f)| f).collect(),
        Fields::Unnamed(fields) => fields.fields.iter_mut().collect(),
        Fields::Unit => vec![],
    };
    for field in fields {
        field.attributes.remove("serde:field:default");
        if let Some(ty) = &mut field.ty {
            defaults(ty);
        }
    }
}

/// The stable per-type paths consumed by the App and CLI.
pub fn types() -> specta::Types {
    crate::declarations::types()
        .register::<crate::event::EventData>()
        .register::<crate::event::Event>()
        .register::<crate::agent::NodeKind>()
        .register::<crate::agent::Worktree>()
        .register::<crate::agent::RemovalKind>()
        .register::<crate::agent::KeptReason>()
        .register::<crate::agent::RemovedItem>()
        .register::<crate::agent::KeptItem>()
        .register::<crate::agent::Removal>()
        .register::<crate::agent::WorktreeState>()
        .register::<crate::agent::WorktreeEvidenceState>()
        .register::<crate::agent::WorktreeCheckConclusion>()
        .register::<crate::agent::WorktreeRequiredCheck>()
        .register::<crate::agent::WorktreeEvidence>()
        .register::<crate::agent::WorktreeCi>()
        .register::<crate::agent::WorktreeCiState>()
        .register::<crate::agent::WorktreePr>()
        .register::<crate::agent::ChangedStatus>()
        .register::<crate::agent::ChangedFile>()
        .register::<crate::agent::ChangedFiles>()
        .register::<crate::agent::CompareFileParams>()
        .register::<crate::agent::FileContent>()
        .register::<crate::agent::FileComparison>()
        .register::<crate::agent::Landed>()
        .register::<crate::agent::Order>()
        .register::<crate::agent::RailNode>()
        .register::<crate::agent::ConversationOverview>()
        .register::<crate::agent::ContextPart>()
        .register::<crate::agent::ContextPartKind>()
        .register::<crate::agent::ConversationCard>()
        .register::<crate::agent::Inbox>()
        .register::<crate::agent::Stray>()
        .register::<crate::agent::StrayEvent>()
        .register::<crate::agent::Channel>()
        .register::<crate::agent::ChannelEvent>()
        .register::<crate::agent::Brief>()
        .register::<crate::agent::Skill>()
        .register::<crate::agent::Skills>()
        .register::<crate::agent::ParentNode>()
        .register::<crate::agent::ContextSelf>()
        .register::<crate::agent::ContextParent>()
        .register::<crate::agent::ContextAsk>()
        .register::<crate::agent::ContextPeer>()
        .register::<crate::agent::ContextTodo>()
        .register::<crate::agent::DigestEntry>()
        .register::<crate::agent::DigestItem>()
        .register::<crate::agent::Digest>()
        .register::<crate::agent::WakeParams>()
        .register::<crate::agent::Woken>()
        .register::<crate::agent::Context>()
        .register::<crate::agent::SetModelParams>()
        .register::<crate::agent::RunParams>()
        .register::<crate::agent::NodeId>()
        .register::<crate::agent::ResumeMode>()
        .register::<crate::agent::Instruction>()
        .register::<crate::agent::InstructionRevision>()
        .register::<crate::agent::InstructionState>()
        .register::<crate::agent::InstructionDelivery>()
        .register::<crate::agent::Instructions>()
        .register::<crate::agent::ResumeParams>()
        .register::<crate::agent::PromptParams>()
        .register::<crate::agent::SignalParams>()
        .register::<crate::agent::SignalOutcome>()
        .register::<crate::agent::CreateWorkstreamParams>()
        .register::<crate::agent::CapturedOrder>()
        .register::<crate::agent::SetOrderParams>()
        .register::<crate::agent::MoveParams>()
        .register::<crate::agent::RenameParams>()
        .register::<crate::agent::StatusEvent>()
        .register::<crate::agent::ToolCallState>()
        .register::<crate::agent::ToolCall>()
        .register::<crate::agent::ToolCallEvent>()
        .register::<crate::todo::Todo>()
        .register::<crate::todo::Handed>()
        .register::<crate::todo::CreateParams>()
        .register::<crate::todo::AssignParams>()
        .register::<crate::todo::HandParams>()
        .register::<crate::todo::TodoId>()
        .register::<crate::todo::UpdateParams>()
        .register::<crate::todo::SetBlockersParams>()
        .register::<crate::todo::MoveParams>()
        .register::<crate::todo::ReorderParams>()
        .register::<crate::todo::Values>()
        .register::<crate::todo::Change>()
        .register::<crate::todo::History>()
        .register::<crate::todo::ReadHistoryParams>()
        .register::<crate::todo::Comment>()
        .register::<crate::todo::CommentParams>()
        .register::<crate::todo::RefParams>()
        .register::<crate::todo::RefState>()
        .register::<crate::todo::Ref>()
        .register::<crate::todo::UnreadComment>()
        .register::<crate::link::LinkUrl>()
        .register::<crate::link::Section>()
        .register::<crate::link::LinkContent>()
        .register::<crate::terminal::SpawnParams>()
        .register::<crate::terminal::TerminalId>()
        .register::<crate::terminal::Opened>()
        .register::<crate::terminal::OpenParams>()
        .register::<crate::terminal::WriteParams>()
        .register::<crate::terminal::ResizeParams>()
        .register::<crate::terminal::Scheme>()
        .register::<crate::terminal::SchemeParams>()
        .register::<crate::terminal::TerminalInfo>()
        .register::<crate::terminal::OutputStarted>()
        .register::<crate::terminal::OutputEvent>()
        .register::<crate::terminal::OutputGap>()
        .register::<crate::terminal::CatchUpParams>()
        .register::<crate::terminal::CatchUp>()
        .register::<crate::terminal::Snapshot>()
        .register::<crate::terminal::TitleEvent>()
        .register::<crate::terminal::ExitedEvent>()
        .register::<crate::terminal::ReadParams>()
        .register::<crate::terminal::Read>()
        .register::<crate::terminal::SearchParams>()
        .register::<crate::terminal::Match>()
        .register::<crate::terminal::Search>()
        .register::<crate::terminal::Screen>()
        .register::<crate::reaction::Condition>()
        .register::<crate::reaction::LatePolicy>()
        .register::<crate::reaction::PreviewParams>()
        .register::<crate::reaction::Preview>()
        .register::<crate::reaction::CreateParams>()
        .register::<crate::reaction::ReactionId>()
        .register::<crate::reaction::RunParams>()
        .register::<crate::reaction::State>()
        .register::<crate::reaction::Observation>()
        .register::<crate::reaction::Firing>()
        .register::<crate::reaction::Reaction>()
        .register::<crate::project::Worktrees>()
        .register::<crate::project::Prepared>()
        .register::<crate::project::PrepareParams>()
        .register::<crate::project::Mcp>()
        .register::<crate::project::ProjectSettings>()
        .register::<crate::project::Choice>()
        .register::<crate::project::ModelList>()
        .register::<crate::project::RoleModels>()
        .register::<crate::project::ProjectModels>()
        .register::<crate::project::OpenParams>()
        .register::<crate::project::RenameParams>()
        .register::<crate::project::Requested>()
        .register::<crate::project::AgentResources>()
        .register::<crate::project::ResourceTotal>()
        .register::<crate::project::Resources>()
        .register::<crate::project::ImportPeriod>()
        .register::<crate::project::ImportDiscoverParams>()
        .register::<crate::project::ImportCandidate>()
        .register::<crate::project::ImportExclusionCause>()
        .register::<crate::project::ImportFailure>()
        .register::<crate::project::ImportDisposition>()
        .register::<crate::common::RpcErrorData>()
        .register::<crate::reaction::ObservationCause>()
        .register::<crate::reaction::ObservationGap>()
        .register::<crate::reaction::ObservationRecovery>()
        .register::<crate::reaction::ObservationHealth>()
        .register::<crate::project::ImportExclusion>()
        .register::<crate::project::ImportDiscovery>()
        .register::<crate::project::ImportListParams>()
        .register::<crate::project::ImportLive>()
        .register::<crate::project::ImportListed>()
        .register::<crate::project::ImportList>()
        .register::<crate::project::ImportSelection>()
        .register::<crate::project::ImportCommitParams>()
        .register::<crate::project::ImportOutcome>()
        .register::<crate::project::ImportResult>()
        .register::<crate::workstream::AutoParams>()
        .register::<crate::workstream::OpeningPromptParams>()
        .register::<crate::workstream::StartChoice>()
        .register::<crate::workstream::StartWorkstreamParams>()
        .register::<crate::workstream::QueueEntry>()
        .register::<crate::workstream::QueueFailure>()
        .register::<crate::workstream::QueueState>()
        .register::<crate::workstream::QueuedWorkstream>()
        .register::<crate::workstream::QueueMoveParams>()
        .register::<crate::workstream::CapParams>()
        .register::<crate::workstream::RewindTurn>()
        .register::<crate::workstream::RewindParams>()
        .register::<crate::workstream::RewindState>()
        .register::<crate::workstream::RewindAgent>()
        .register::<crate::workstream::Rewind>()
        .register::<crate::pad::Pad>()
        .register::<crate::pad::CreateParams>()
        .register::<crate::pad::PadName>()
        .register::<crate::pad::WriteParams>()
        .register::<crate::pad::AppendParams>()
        .register::<crate::pad::AppendSectionParams>()
        .register::<crate::pad::ExportParams>()
        .register::<crate::pad::SetStorageParams>()
        .register::<crate::pad::MoveParams>()
        .register::<crate::message::MessageKind>()
        .register::<crate::message::MessageStatus>()
        .register::<crate::message::Reason>()
        .register::<crate::message::Message>()
        .register::<crate::message::SendParams>()
        .register::<crate::message::MessageId>()
        .register::<crate::message::ListParams>()
        .register::<crate::message::Delivery>()
        .register::<crate::message::Route>()
        .register::<crate::message::SetRouteParams>()
        .register::<crate::message::ProgressParams>()
        .register::<crate::message::ResultTarget>()
        .register::<crate::message::ResultCheck>()
        .register::<crate::message::ResultState>()
        .register::<crate::message::ReportParams>()
        .register::<crate::message::ResultId>()
        .register::<crate::message::AcceptResultParams>()
        .register::<crate::message::ResolveResultParams>()
        .register::<crate::message::ResultResolution>()
        .register::<crate::message::ResultOutcome>()
        .register::<crate::message::ResultReport>()
        .register::<crate::message::ResultAcceptance>()
        .register::<crate::message::ResultObservation>()
        .register::<crate::message::ResultProgress>()
        .register::<crate::message::Progress>()
        .register::<crate::message::ResumeWorkParams>()
        .register::<crate::message::ContinuationAction>()
        .register::<crate::message::ContinuationBlock>()
        .register::<crate::message::ContinuationContext>()
        .register::<crate::message::Reconciliation>()
        .register::<crate::message::ContinuationChoice>()
        .register::<crate::message::ResumeWork>()
        .register::<crate::ask::Ask>()
        .register::<crate::ask::AskPart>()
        .register::<crate::ask::Placement>()
        .register::<crate::ask::State>()
        .register::<crate::ask::SendParams>()
        .register::<crate::ask::PickParams>()
        .register::<crate::ask::Target>()
        .register::<crate::deliverable::PublicationTarget>()
        .register::<crate::deliverable::PublishParams>()
        .register::<crate::deliverable::PublishedTarget>()
        .register::<crate::deliverable::ExternalAvailability>()
        .register::<crate::deliverable::Deliverable>()
        .register::<crate::deliverable::DeliverableId>()
        .register::<crate::deliverable::ListParams>()
        .register::<crate::deliverable::MoveParams>()
        .register::<crate::deliverable::UnavailableCause>()
        .register::<crate::deliverable::Resolution>()
        .register::<crate::common::ActorKind>()
        .register::<crate::common::Actor>()
        .register::<crate::common::Kind>()
        .register::<crate::common::Status>()
        .register::<crate::common::Verb>()
        .register::<crate::common::Touch>()
        .register::<crate::common::IdentifyParams>()
        .register::<crate::common::SubscribeResult>()
        .register::<crate::common::SubscribeParams>()
        .register::<crate::common::HistoryParams>()
        .register::<crate::common::TouchedParams>()
        .register::<crate::attachment::SaveParams>()
        .register::<crate::attachment::Saved>()
        .register::<crate::agent::SpawnParams>()
        .register::<crate::agent::Extras>()
        .register::<crate::agent::ExtrasAddParams>()
        .register::<crate::agent::StartDoorParams>()
        .register::<crate::agent::PermissionMode>()
        .map(|mut ty| {
            let module = ty.module_path.split("::").nth(1).unwrap_or("");
            ty.module_path = if matches!(module, "common" | "event") {
                ty.name.to_string()
            } else {
                format!("{module}::{}", ty.name)
            }
            .into();
            if let Some(dt) = &mut ty.ty {
                defaults(dt);
            }
            ty
        })
}

/// Export all contracts without relying on side effects in a test binary.
pub fn generate(root: &std::path::Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    specta_typescript::Typescript::default()
        .layout(specta_typescript::Layout::Files)
        .export_to(root, &types(), specta_serde::Format)?;
    let (declaration, imports) = event_data_declaration()?;
    std::fs::write(
        root.join("EventData.ts"),
        format!("// Generated by Specta. Do not edit.\n{imports}\n{declaration}\n"),
    )?;
    let exported = crate::declarations::exported();
    std::fs::write(
        root.join("methods.ts"),
        crate::methods::render_typescript(&exported),
    )?;
    let methods: Vec<_> = exported
        .iter()
        .map(crate::methods::ExportedMethod::method)
        .collect();
    std::fs::write(
        root.join("contract.ts"),
        crate::methods::render_contract_typescript_of(&methods),
    )?;
    let mut rust = String::from("// @generated from the RPC declarations. Do not edit.\n&[\n");
    for method in &methods {
        rust.push_str(&format!(
            "    Method {{ name: {:?}, params: {:?}, result: {:?} }},\n",
            method.name, method.params, method.result
        ));
    }
    rust.push_str("]\n");
    std::fs::write(root.join("methodTypes.rs"), rust)?;
    Ok(())
}

/// Retain the tagged union's existing textual declaration as well as its type shape (C4 Check 2).
pub fn event_data_declaration() -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>>
{
    use specta::Format;
    let types = specta_serde::Format.map_types(&types())?.into_owned();
    let event = types
        .into_sorted_iter()
        .find(|ty| ty.name == "EventData")
        .expect("EventData is registered");
    let (declaration, references) = specta_typescript::collect_references(|| {
        specta_typescript::primitives::export(
            &specta_typescript::Typescript::default(),
            &types,
            std::iter::once(event),
            "",
        )
    });
    // This is punctuation formatting only; Specta still renders every variant and payload type.
    let declaration = declaration?
        .replace("{ name: ", "{ \"name\": ")
        .replace("; data: ", ", \"data\": ");
    let mut imports = std::collections::BTreeSet::new();
    for reference in references {
        let ty = types.get(&reference).expect("registered reference");
        imports.insert(format!(
            "import type {{ {} }} from \"./{}\";\n",
            ty.name,
            ty.module_path.replace("::", "/")
        ));
    }
    Ok((declaration, imports.into_iter().collect()))
}
