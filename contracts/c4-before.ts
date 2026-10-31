// C4: pre-migration type shapes from main 09f5f6611149162c403fe07adf8e757190fb2bf2; frozen independently of the exporter.
// Todo restoration contracts and Event unions also include main c8c12a4a3 (U3787a).
// Pad deletion receipts and restoration contracts include U3787a (#3918).
// RpcErrorData includes `other-project` from U3787f (#4225) and named Undo refusals from U3787a (#4668).

export type Actor = { kind: ActorKind, id: string, parent: string | null, };

export type ActorKind = "user" | "agent" | "ext";

export type Event = { 

seq?: number, actor: Actor, } & ({ "name": "workstream.updated", "data": workstream_AutoParams } | { "name": "ask.changed", "data": { ask: ask_Ask, } } | { "name": "terminal.title", "data": terminal_TitleEvent } | { "name": "terminal.exited", "data": terminal_ExitedEvent } | { "name": "terminal.changed" } | { "name": "terminal.shown", "data": terminal_TerminalId } | { "name": "todo.created", "data": todo_Todo } | { "name": "todo.updated", "data": todo_Todo } | { "name": "todo.restored", "data": todo_Todo } | { "name": "todo.unblocked", "data": todo_TodoId } | { "name": "todo.deleted", "data": todo_TodoId } | { "name": "todo.commented", "data": todo_TodoId } | { "name": "todo.commentsRead", "data": todo_TodoId } | { "name": "todo.refAdded", "data": todo_TodoId } | { "name": "todo.refRemoved", "data": todo_TodoId } | { "name": "pad.changed", "data": pad_PadName } | { "name": "pad.renamed", "data": { incarnation: string, name: string, previous_name: string, } } | { "name": "pad.deleted", "data": pad_PadName } | { "name": "message.sent", "data": message_Message } | { "name": "message.delivered", "data": message_Message } | { "name": "message.dropped", "data": message_Message } | { "name": "route.changed", "data": message_Route } | { "name": "agent.status", "data": agent_StatusEvent } | { "name": "agent.channel", "data": agent_ChannelEvent } | { "name": "agent.stray", "data": agent_StrayEvent } | { "name": "agent.toolCall", "data": agent_ToolCallEvent } | { "name": "rail.changed" } | { "name": "rail.renamed", "data": { id: string, name: string, } } | { "name": "project.requested", "data": project_Requested } | { "name": "workstream.queueChanged" });

export type EventData = { "name": "workstream.updated", "data": workstream_AutoParams } | { "name": "ask.changed", "data": { ask: ask_Ask, } } | { "name": "terminal.title", "data": terminal_TitleEvent } | { "name": "terminal.exited", "data": terminal_ExitedEvent } | { "name": "terminal.changed" } | { "name": "terminal.shown", "data": terminal_TerminalId } | { "name": "todo.created", "data": todo_Todo } | { "name": "todo.updated", "data": todo_Todo } | { "name": "todo.restored", "data": todo_Todo } | { "name": "todo.unblocked", "data": todo_TodoId } | { "name": "todo.deleted", "data": todo_TodoId } | { "name": "todo.commented", "data": todo_TodoId } | { "name": "todo.commentsRead", "data": todo_TodoId } | { "name": "todo.refAdded", "data": todo_TodoId } | { "name": "todo.refRemoved", "data": todo_TodoId } | { "name": "pad.changed", "data": pad_PadName } | { "name": "pad.renamed", "data": { incarnation: string, name: string, previous_name: string, } } | { "name": "pad.deleted", "data": pad_PadName } | { "name": "message.sent", "data": message_Message } | { "name": "message.delivered", "data": message_Message } | { "name": "message.dropped", "data": message_Message } | { "name": "route.changed", "data": message_Route } | { "name": "agent.status", "data": agent_StatusEvent } | { "name": "agent.channel", "data": agent_ChannelEvent } | { "name": "agent.stray", "data": agent_StrayEvent } | { "name": "agent.toolCall", "data": agent_ToolCallEvent } | { "name": "rail.changed" } | { "name": "rail.renamed", "data": { id: string, name: string, } } | { "name": "project.requested", "data": project_Requested } | { "name": "workstream.queueChanged" };

export type HistoryParams = { item: string, };

export type IdentifyParams = { actor: Actor, };

export type Kind = "error" | "needs-you" | "blocked" | "working" | "idle" | "done";

export type RpcErrorData = { "kind": "events-expired", 

oldest: number, } | { "kind": "other-project", } | { kind: "undo-parent", id: string, name: string } | { kind: "undo-identity", id: string, name: string } | { kind: "undo-pad-name", name: string };

export type Status = { kind: Kind, label: string, 

since: number, 

finished: string, };

export type SubscribeParams = { after?: number, };

export type SubscribeResult = { head: number, };

export type Touch = { actor: Actor, verb: Verb, item: string, at: number, };

export type TouchedParams = { actor_id: string, };

export type Verb = "read" | "wrote";

export type agent_Brief = { stdout: string, };

export type agent_CapturedOrder = { order: agent_Order | null, };

export type agent_ChangedFile = { path: string, status: agent_ChangedStatus, line: number | null, from?: string, };

export type agent_ChangedFiles = { files: Array<agent_ChangedFile>, };

export type agent_ChangedStatus = "added" | "modified" | "renamed" | "deleted" | "untracked";

export type agent_Channel = "pending" | "up" | "missing";

export type agent_ChannelEvent = { id: string, channel: agent_Channel, };

export type agent_CompareFileParams = { id: string, path: string, };

export type agent_Context = { self: agent_ContextSelf, parent: agent_ContextParent | null, ask: agent_ContextAsk, peers: Array<agent_ContextPeer>, todos: Array<agent_ContextTodo>, };

export type agent_ContextAsk = { to: string, };

export type agent_ContextParent = { id: string, name: string, node: agent_ParentNode, };

export type agent_ContextPart = { kind: agent_ContextPartKind, tokens: number, };

export type agent_ContextPartKind = "system" | "tools" | "files" | "conversation" | "other";

export type agent_ContextPeer = { id: string, name: string, status: Status, };

export type agent_ContextSelf = { id: string, name: string, status: Status, 

order: agent_Order | null, };

export type agent_ContextTodo = { id: number, title: string, blocked: boolean, };

// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- C4 preserves ConversationCard.shape, the A2681c domain term in GLOSSARY.md.
export type agent_ConversationCard = { intent?: string, shape?: string, facts?: Array<string>, outcome?: string, };

export type agent_ConversationOverview = { program: string, id: string, name?: string, 

used?: number, 

limit?: number, 

context_parts?: Array<agent_ContextPart>, card?: agent_ConversationCard, };

export type agent_CreateWorkstreamParams = { name: string, parent: string | null, 

order?: agent_Order, };

export type agent_Digest = { children: Array<agent_DigestItem>, };

export type agent_DigestEntry = { name: string, kind: Kind, last: string, todos: number, pads: Array<string>, };

export type agent_DigestItem = agent_DigestEntry | { more: number, };

export type agent_Extras = { skills: Array<string>, plugins: Array<string>, mcp: Array<string>, };

export type agent_ExtrasAddParams = { id: string, extras: agent_Extras, };

export type agent_FileComparison = { base: string, oldPath: string, newPath: string, status: agent_ChangedStatus | null, old: agent_FileContent, new: agent_FileContent, };

export type agent_FileContent = { "kind": "absent", revision: string, } | { "kind": "text", revision: string, text: string, } | { "kind": "binary", revision: string, };

export type agent_Inbox = "ok" | "missing" | "mismatch";

export type agent_Instruction = { "kind": "order", order: agent_Order, } | { "kind": "message", message: number, text: string, };

export type agent_InstructionDelivery = { id: string, revision: string, attempt: string, text: string, state: agent_InstructionState, };

export type agent_InstructionRevision = { revision: string, agent: string, workstream: string | null, } & ({ "kind": "order", order: agent_Order, } | { "kind": "message", message: number, text: string, });

export type agent_InstructionState = "prepared" | "uncertain" | "submitted" | "refused";

export type agent_Instructions = { project: string, home: string | null, current: string | null, revisions: Array<agent_InstructionRevision>, deliveries: Array<agent_InstructionDelivery>, };

export type agent_KeptItem = { id: string, kind: agent_RemovalKind, name: string, reason: agent_KeptReason, };

export type agent_KeptReason = "running" | "dirty" | "ahead" | "open";

export type agent_Landed = { base: string, };

export type agent_MoveParams = { id: string, parent: string | null, index: number, };

export type agent_NodeId = { id: string, };

export type agent_NodeKind = "workstream" | "agent";

export type agent_Order = { "kind": "work", 

title?: string, ask: string, 

done?: string, limits: Array<string>, } | { "kind": "clarification", question: string, };

export type agent_ParentNode = "group" | "agent";

export type agent_PermissionMode = "default" | "acceptEdits" | "plan" | "auto";

export type agent_PromptParams = { id: string, text: string, };

export type agent_RailNode = { 

auto?: boolean, id: string, kind: agent_NodeKind, name: string, parent: string | null, 

order: number, 

status: Status | null, 

attempt: string | null, 

status_revision: string | null, 

terminal_id: string | null, 

worktree: agent_Worktree | null, 

can_resume: boolean, 
can_make_workstream: boolean,
can_save_as_mode: boolean,

yolo: boolean, 

channel: agent_Channel | null, 

work: agent_Order | null, 

stray: Array<agent_Stray>, 

model: string | null, 

effort: string | null, 



inbox?: agent_Inbox, 

tool_call?: agent_ToolCall, 

overview?: agent_ConversationOverview, };

export type agent_Removal = { removed: Array<agent_RemovedItem>, kept: Array<agent_KeptItem>, };

export type agent_RemovalKind = "agent" | "todo" | "pad";

export type agent_RemovedItem = { id: string, kind: agent_RemovalKind, name: string, };

export type agent_RenameParams = { id: string, name: string, };

export type agent_ResumeMode = "normal" | "yolo";

export type agent_ResumeParams = { 

permissionMode?: agent_PermissionMode, id: string, mode?: agent_ResumeMode, };

export type agent_RunParams = { id: string, command: Array<string>, cwd?: string, };

export type agent_SetModelParams = { id: string, 

model: string | null, effort: string | null, 

confirmed: boolean, };

export type agent_SetOrderParams = { id: string, order: agent_Order, captured?: agent_CapturedOrder, };

export type agent_SignalOutcome = { drop: boolean, };

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- C4 freezes the pre-migration opaque signal payload contract for bidirectional comparison.
export type agent_SignalParams = { id: string, attempt: string, payload: Record<string, unknown>, };

export type agent_Skill = { name: string, 

description: string, };

export type agent_Skills = { skills: Array<agent_Skill>, };

export type agent_SpawnParams = { 

permissionMode?: agent_PermissionMode, 

engine?: string, cwd: string, prompt: string | null, parent: string | null, 

order?: agent_Order, 

name?: string, 

model?: string | null, 

effort?: string | null, 

scout?: boolean, 

specialist?: string, 

extras?: agent_Extras, };

export type agent_StartDoorParams = { 

permissionMode?: agent_PermissionMode, 

engine?: string, id: string, model?: string, effort?: string, };

export type agent_StatusEvent = { ended?: boolean, id: string, attempt: string, status_revision: string, status: Status, };

export type agent_Stray = { pid: number, command: string, };

export type agent_StrayEvent = { id: string, stray: Array<agent_Stray>, };

export type agent_ToolCall = { tool: string, 

summary?: string, arguments: string, 

result?: string, state: agent_ToolCallState, 

started: number, 

duration_ms?: number, };

export type agent_ToolCallEvent = { id: string, call: agent_ToolCall, };

export type agent_ToolCallState = "running" | "done" | "failed";

export type agent_WakeParams = { 

ids: Array<string>, 

any?: boolean, };

export type agent_Woken = { id: number, fired: boolean, why?: string, };

export type agent_Worktree = { path: string, branch: string, base: string, };

export type agent_WorktreeCheckConclusion = "passed" | "failed" | "skipped" | "cancelled";

export type agent_WorktreeCi = { state: agent_WorktreeCiState, stale: boolean, };

export type agent_WorktreeCiState = "passed" | "failed" | "running" | "no-ci" | "conflicts" | "error" | "unknown";

export type agent_WorktreeEvidence = { state: agent_WorktreeEvidenceState, 

stale: boolean, 

repository?: string, head?: string, checks: Array<agent_WorktreeRequiredCheck>, 

read_at?: number, 

revision?: string, };

export type agent_WorktreeEvidenceState = "complete" | "incomplete" | "stale-head" | "unknown" | "unavailable";

export type agent_WorktreePr = { number: number, stale: boolean, };

export type agent_WorktreeRequiredCheck = { name: string, conclusion: agent_WorktreeCheckConclusion, };

export type agent_WorktreeState = { ahead: number, behind: number, dirty: boolean, ci?: agent_WorktreeCi, pr?: agent_WorktreePr, evidence?: agent_WorktreeEvidence, };

export type ask_Ask = { id: string, text: string, at: bigint, parts: Array<ask_AskPart>, submission?: string, };

export type ask_AskPart = { text: string, placement: ask_Placement, state: ask_State, reason?: string, };

export type ask_PickParams = { id: string, part: number, target: ask_Target, };

export type ask_Placement = { "kind": "routed", workstream: string, } | { "kind": "new", title: string, workstream?: string, } | { "kind": "unclear", question: string, candidates: Array<string>, };

export type ask_SendParams = { text: string, submission?: string, workstream?: string, };

export type ask_State = "placing" | "waiting" | "queued" | "typed" | "failed" | "dropped";

export type ask_Target = { "kind": "workstream", id: string, } | { "kind": "new", title?: string, } | { "kind": "drop" };

export type attachment_SaveParams = { name: string, 

data: string, };

export type attachment_Saved = { 

path: string, };

export type deliverable_Deliverable = { project: string, id: string, maker: Actor, maker_name: string, home: string | null, title: string, published_at: number, target: deliverable_PublishedTarget, };

export type deliverable_DeliverableId = { project: string, id: string, };

export type deliverable_ExternalAvailability = "not-checked";

export type deliverable_ListParams = { home: string | null, maker: string | null, };

export type deliverable_MoveParams = { project: string, id: string, home: string | null, };

export type deliverable_PublicationTarget = { "kind": "pad", name: string, incarnation: string, revision: number, } | { "kind": "file", path: string, } | { "kind": "external", url: string, };

export type deliverable_PublishParams = { key: string, title: string, target: deliverable_PublicationTarget, };

export type deliverable_PublishedTarget = { "kind": "pad", name: string, incarnation: string, revision: number, length: number, sha256: string, } | { "kind": "file", path: string, length: number, sha256: string, } | { "kind": "external", url: string, availability: deliverable_ExternalAvailability, };

export type deliverable_Resolution = { "kind": "retained", path: string, sha256: string, } | { "kind": "external", url: string, availability: deliverable_ExternalAvailability, } | { "kind": "unavailable", cause: deliverable_UnavailableCause, };

export type deliverable_UnavailableCause = "missing-revision" | "integrity-failure" | "access-revoked" | "source-unknown" | "materialization-failed";

export type link_LinkContent = { "kind": "deliverable", record: deliverable_Deliverable, resolution: deliverable_Resolution, } | { "kind": "pad", id: string, pad: pad_Pad, 

section?: link_Section, } | { "kind": "todo", id: string, todo: todo_Todo, } | { "kind": "agent", id: string, node: agent_RailNode, digest: agent_Digest | null, } | { "kind": "workstream", id: string, node: agent_RailNode, children: Array<string>, } | { "kind": "terminal", id: string, screen: terminal_Screen, };

export type link_LinkUrl = { url: string, };

export type link_Section = { heading: string, text: string, };

export type message_AcceptResultParams = { project: string, id: string, report: string, evidence: string, };

export type message_ContinuationAction = { id: string, report: string, target: message_ResultTarget, output: string, instruction: string, next: string, 

decision: string | null, };

export type message_ContinuationBlock = { report: string, target: message_ResultTarget, cause: string, action: string, };

export type message_ContinuationChoice = { id: string, request: string, actions: Array<string>, message: number, };

export type message_ContinuationContext = { report: string, target: message_ResultTarget, current: boolean, confirmed: string, };

export type message_Delivery = "auto" | "drop";

export type message_ListParams = { to: string | null, 

id?: string, status: message_MessageStatus | null, };

export type message_Message = { id: number, from: Actor, to: string, kind: message_MessageKind, body: string, replyTo: number | null, status: message_MessageStatus, reason: message_Reason | null, at: number, 

};

export type message_MessageId = { id: number, };

export type message_MessageKind = "note" | "question";

export type message_MessageStatus = "pending" | "delivered" | "dropped";

export type message_Progress = { instructions: agent_Instructions, results: Array<message_ResultProgress>, };

export type message_ProgressParams = { project: string, id: string, };

export type message_Reason = "receiver gone" | "not accepted" | "removed" | "merged";

export type message_Reconciliation = { agent: string, actions: Array<message_ContinuationAction>, blocked: Array<message_ContinuationBlock>, context: Array<message_ContinuationContext>, pending_checks: Array<message_ResultTarget>, };

export type message_ReportParams = { project: string, id: string, key: string, delivery: string, target: message_ResultTarget, output: deliverable_DeliverableId, result: string, next: string, state: message_ResultState, check: message_ResultCheck, };

export type message_ResolveResultParams = { project: string, id: string, report: string, source: string, };

export type message_ResultAcceptance = { actor: Actor, evidence: string, };

export type message_ResultCheck = { "kind": "publication", sha256: string, } | { "kind": "pr-checks", repository: string, number: number, head: string, } | { "kind": "unsupported", source: string, };

export type message_ResultId = { project: string, id: string, report: string, };

export type message_ResultObservation = { "verdict": "passed", revision: string, } | { "verdict": "unknown", cause: string, action: string, } | { "verdict": "resolved", source: string, authorizer: Actor, evidence: message_ResultResolution, };

export type message_ResultOutcome = { "kind": "completed" } | { "kind": "not-performed" } | { "kind": "inconclusive", cause: string, };

export type message_ResultProgress = { report: message_ResultReport, current: boolean, acceptances: Array<message_ResultAcceptance>, observations: Array<message_ResultObservation>, availability: deliverable_Resolution, };

export type message_ResultReport = { order_revision: string | null, report: string, author: Actor, attempt: string, home: string | null, request: message_ReportParams, instruction: agent_InstructionRevision, publication: deliverable_Deliverable, };

export type message_ResultResolution = { target: message_ResultTarget, revision: string, 

observed_at: number, outcome: message_ResultOutcome, };

export type message_ResultState = "reported" | "unknown-effect";

export type message_ResultTarget = { id: string, revision: string, };

export type message_ResumeWork = { decision: message_ContinuationChoice | null, reconciliation: message_Reconciliation, };

export type message_ResumeWorkParams = { project: string, id: string, request: string, action?: string, };

export type message_Route = { from: string, to: string, delivery: message_Delivery, };

export type message_SendParams = { to: string, kind: message_MessageKind, body: string, replyTo: number | null, };

export type message_SetRouteParams = { from: string, to: string, delivery: message_Delivery, };

export type pad_AppendParams = { name: string, text: string, };

export type pad_AppendSectionParams = { name: string, heading: string, text: string, expectedRevision?: number | null, };

export type pad_CreateParams = { name: string, text: string | null, };

export type pad_ExportParams = { name: string, path: string, };

export type pad_MoveParams = { name: string, home: string | null, };

export type pad_Pad = { 

incarnation: string, name: string, text: string, updated_at: number, 

revision: number, 

home: string | null, };

export type pad_DeleteParams = { name: string, operation?: string, expectedIncarnation?: string, };

export type pad_Deletion = { project: string, operation: string, pad: pad_Pad, restored: boolean, };

export type pad_DeletionId = { project: string, operation: string, };

export type pad_GetDeletionParams = { operation: string, };

export type pad_PadName = { name: string, };

export type pad_RenameParams = { name: string, newName: string, expectedIncarnation: string, };


export type pad_SetStorageParams = { files: boolean, };

export type pad_WriteParams = { name: string, text: string, expectedRevision?: number | null, 

expectedIncarnation?: string, };

export type project_AgentResources = { id: string, 

memory_bytes: number, 

cpu_percent: number, 

disk_bytes: number | null, };

export type project_Choice = { id: string, label: string, };



export type project_ImportCandidate = { source: string, title: string, 

cwd: string, last_activity_ms: bigint, revision: string, };

export type project_ImportCommitParams = { selections: Array<project_ImportSelection>, };

export type project_ImportDiscoverParams = { period: project_ImportPeriod, };

export type project_ImportDiscovery = { candidates: Array<project_ImportCandidate>, excluded: Array<project_ImportExclusion>, };

export type project_ImportDisposition = "failed" | "unknown";

export type project_ImportExclusion = { source: string, cause: project_ImportExclusionCause, reason: string, 

title: string | null, 

last_activity_ms: bigint | null, };

export type project_ImportExclusionCause = "alreadyImported" | "ambiguousProject" | "missingDirectory" | "noDirectory" | "tooManyDirectories" | "insideWorktree" | "duplicateSource" | "unknownActivity" | "noCompleteRecords" | "unsupportedSource" | "previewLimit" | "recordLimit" | "snapshotLimit" | "malformedRecord" | "subagentRecord" | "foreignIdentity" | "metadataLimit" | "incompleteMetadata" | "sdkUnreadable" | "recordsMissing" | "insideRoundup" | "liveWithoutRecords" | "unknown";

export type project_ImportFailure = { code: number, message: string, outcome: project_ImportDisposition, };

export type project_ImportList = { candidates: Array<project_ImportListed>, excluded: Array<project_ImportExclusion>, notices: Array<string>, sdk: string, };

export type project_ImportListParams = { period: project_ImportPeriod, };

export type project_ImportListed = { source: string, title: string, 

cwd: string, last_activity_ms: bigint, revision: string, live: project_ImportLive | null, };

export type project_ImportLive = { pid: number | null, cwd: string | null, name: string | null, busy: boolean | null, started_at_ms: bigint | null, };

export type project_ImportOutcome = { source: string, workstream: string | null, agent: string | null, error: project_ImportFailure | null, };

export type project_ImportPeriod = "day" | "week" | "month";

export type project_ImportResult = { outcomes: Array<project_ImportOutcome>, };

export type project_ImportSelection = { source: string, revision: string, };

export type project_Mcp = { on: boolean, };









export type project_ModelList = { engines: Array<project_Choice>, models: Array<project_Choice>, efforts: Array<project_Choice>, };


export type project_OpenParams = { 

path: string, };

export type project_PrepareParams = { path: string, };

export type project_Prepared = { enrolled: Array<string>, 

readiness: string | null, 

timeout_ms: bigint | null, 

setup: string | null, };

export type project_ProjectModels = { roles: Array<project_RoleModels>, };

export type project_ProjectSettings = { worktrees: project_Worktrees, 

models: project_ProjectModels, mcp: project_Mcp, 

workstreamCap: number | null, };

export type project_RenameParams = { name: string, };

export type project_Requested = { "kind": "open", path: string, } | { "kind": "rename", path: string, name: string, };

export type project_ResourceTotal = { memory_bytes: number, cpu_percent: number, 

disk_bytes: number | null, };

export type project_Resources = { agents: Array<project_AgentResources>, total: project_ResourceTotal, };

export type project_RoleModels = { role: string, model: string | null, effort: string | null, };



export type project_Worktrees = { on: boolean, 

check: string | null, };

export type reaction_Condition = { "kind": "agents", ids: Array<string>, any?: boolean, } | { "kind": "pr-checks", repository: string, number: number, } | { "kind": "instant", at: string, late: reaction_LatePolicy, };

export type reaction_CreateParams = { 

operation: string, 

name: string, reason: string, 

target: string, 

instruction: string, condition: reaction_Condition, 

max_firings?: number, 

rearm?: boolean, 

expires_at: string, };

export type reaction_Firing = { id: string, ordinal: number, message: number, matched: boolean, 

evidence: string, 

definition: string, 

outcome: string, };

export type reaction_LatePolicy = "once-before-expiry" | "skip";

export type reaction_Observation = { 

health_code: reaction_ObservationHealth, 

cause_code: reaction_ObservationCause, 

gap_code: reaction_ObservationGap, 

recovery_code: reaction_ObservationRecovery, health: string, cursor: number | null, 

gap: string | null, 

recovery: string | null, 

evidence: string | null, 

pinned_head?: string, 

cause?: string, };

export type reaction_ObservationCause = "head-moved" | "agent-unavailable" | "authority-refused" | "checks-failed" | "checks-pending" | "checks-unavailable" | "worktree-read-failed" | "pr-missing" | "evidence-missing" | "evidence-stale" | "forge-read-failed" | "head-missing" | "repository-mismatch" | "unsupported" | "firings-read-failed" | "cursor-missing" | "acceptance-failed" | "observation-save-failed" | "unknown";

export type reaction_ObservationGap = "history-expired" | "agent-read-failed" | "events-read-failed" | "firings-read-failed" | "cursor-missing" | "agent-unavailable" | "authority-refused" | "unknown";

export type reaction_ObservationHealth = "fired" | "fired-late" | "expired" | "skipped" | "observing" | "not-observing" | "unavailable" | "waiting" | "matched" | "invalidated" | "acceptance-failed" | "write-failed" | "observation-save-failed" | "unknown";

export type reaction_ObservationRecovery = "check" | "reconciled" | "replace-agent" | "replace-target" | "restore-evidence" | "retry-acceptance" | "retry-storage" | "reconcile" | "unknown";

export type reaction_Preview = { at: string, utc: string, offset: string, };

export type reaction_PreviewParams = { 

date: string, 

time: string, 

offset: string, };

export type reaction_Reaction = { project: string, id: string, name: string, 

actor: Actor, reason: string | null, 

home: string | null, target: string, instruction: string, condition: reaction_Condition, max_firings: number, remaining: number, rearm: boolean, 

expires_at: string, created_at: string, state: reaction_State, observation: reaction_Observation, firings: Array<reaction_Firing>, };

export type reaction_ReactionId = { id: string, };

export type reaction_RunParams = { id: string, operation: string, };

export type reaction_State = "active" | "stopped" | "invalidated";

export type terminal_ExitedEvent = { id: string, 

code: number | null, };

export type terminal_Match = { 

offset: number, 

text: string, };

export type terminal_OpenParams = { workstream: string | null, };

export type terminal_Opened = { terminal_id: string, };

export type terminal_OutputEvent = { id: string, 

data: string, offset: number, };

export type terminal_OutputGap = { id: string, from: number, to: number, };

export type terminal_OutputStarted = { offset: number, };

export type terminal_Read = { 

from: number, 

next: number, text: string, truncated: boolean, };

export type terminal_ReadParams = { id: string, 

after: number | null, 

reader: string | null, 

max: number | null, };

export type terminal_ResizeParams = { id: string, cols: number, rows: number, };

export type terminal_Scheme = "light" | "dark";

export type terminal_SchemeParams = { scheme: terminal_Scheme, background: string, foreground: string, };

export type terminal_Screen = { cols: number, rows: number, 

offset: number, 

lines: Array<string>, truncated: boolean, };

export type terminal_Search = { matches: Array<terminal_Match>, truncated: boolean, 

next: number, };

export type terminal_SearchParams = { id: string, 

pattern: string, 

after: number | null, 

max: number | null, };

export type terminal_Snapshot = { cols: number, rows: number, after: number, data: string, };

export type terminal_SpawnParams = { cwd: string, 

command: Array<string> | null, env: { [key in string]: string }, cols: number, rows: number, };

export type terminal_TerminalId = { id: string, };

export type terminal_TerminalInfo = { id: string, 

incarnation: string, cwd: string, 

title: string | null, 

program: string, running: boolean, 

exit_code: number | null, 

owner: string | null, };

export type terminal_TitleEvent = { id: string, title: string, };

export type terminal_WriteParams = { id: string, 

data: string, };

export type todo_AssignParams = { id: number, owner: Actor | null, expected_change?: number, };

export type todo_Change = { seq: number, 

actor: Actor | null, 

changed_at: number | null, 

handed?: Actor, 

before: todo_Values | null, after: todo_Values, };

export type todo_Comment = { id: number, 

author: Actor, body: string, created_at: number, 

read: boolean, };

export type todo_CommentParams = { id: number, body: string, };

export type todo_CreateParams = { title: string, body: string | null, blockers: Array<number> | null, 

owner?: Actor, 

priority?: "low" | "medium" | "high" | "urgent" | null, };

export type todo_HandParams = { agent: string, };

export type todo_Handed = { todo: number, owner: Actor, seq: number, };

export type todo_History = { changes: Array<todo_Change>, 

unread: number | null, };

export type todo_MoveParams = { id: number, home: string | null, };

export type todo_ReadHistoryParams = { id: number, through: number, };

export type todo_Ref = { url: string, state: todo_RefState, };

export type todo_RefParams = { id: number, url: string, };

export type todo_RefState = "ok" | "missing";

export type todo_ReorderParams = { id: number, before: number | null, };

export type todo_SetBlockersParams = { id: number, blockers: Array<number>, expected_change?: number, };

export type todo_Todo = { id: number, title: string, body: string, done: boolean, blockers: Array<number>, 

blocked: boolean, created_at: number, updated_at: number, 

creator: Actor, 

home: string | null, 

owner: Actor | null, 

refs: Array<string>, 

priority: "low" | "medium" | "high" | "urgent" | null, };

export type todo_TodoId = { id: number, };

export type todo_UnreadComment = { todo: number, title: string, comment: todo_Comment, };

export type todo_UpdateParams = { id: number, title: string | null, body: string | null, priority?: "low" | "medium" | "high" | "urgent" | null, expected_change?: number, };

export type todo_Values = { title: string, body: string, done: boolean, blockers: Array<number>, 

owner: Actor | null, 

priority: "low" | "medium" | "high" | "urgent" | null, };

export type workstream_AutoParams = { id: string, auto: boolean, };

export type workstream_CapParams = { cap: number | null, };




export type workstream_QueueEntry = { workstream: string, start: workstream_StartChoice, failure?: workstream_QueueFailure, };

export type workstream_QueueFailure = { code: bigint, message: string, };

export type workstream_QueueMoveParams = { workstream: string, index: number, };

export type workstream_QueueState = { running: number, cap: number | null, entries: Array<workstream_QueueEntry>, };

export type workstream_QueuedWorkstream = { workstream: string, };

export type workstream_StartChoice = { "kind": "now" } | { "kind": "queued" } | { "kind": "afterTodo", todo: number, };

export type workstream_StartWorkstreamParams = { id: number, name: string, start: workstream_StartChoice, };



// Frozen from main c8c12a4a3, independently of the Specta outputs.
export type todo_DeleteParams = { operation: string, ids: Array<number> };

export type todo_DeletionParams = { operation: string };

export type todo_DeletionState = "deleted" | "restored";

export type todo_Deletion = { operation: string, deleted: Array<number>, missing: Array<number>, state: todo_DeletionState };

export type Before = {
  "Actor": Actor;
  "ActorKind": ActorKind;
  "Event": Event;
  "EventData": EventData;
  "HistoryParams": HistoryParams;
  "IdentifyParams": IdentifyParams;
  "Kind": Kind;
  "RpcErrorData": RpcErrorData;
  "Status": Status;
  "SubscribeParams": SubscribeParams;
  "SubscribeResult": SubscribeResult;
  "Touch": Touch;
  "TouchedParams": TouchedParams;
  "Verb": Verb;
  "agent/Brief": agent_Brief;
  "agent/CapturedOrder": agent_CapturedOrder;
  "agent/ChangedFile": agent_ChangedFile;
  "agent/ChangedFiles": agent_ChangedFiles;
  "agent/ChangedStatus": agent_ChangedStatus;
  "agent/Channel": agent_Channel;
  "agent/ChannelEvent": agent_ChannelEvent;
  "agent/CompareFileParams": agent_CompareFileParams;
  "agent/Context": agent_Context;
  "agent/ContextAsk": agent_ContextAsk;
  "agent/ContextParent": agent_ContextParent;
  "agent/ContextPart": agent_ContextPart;
  "agent/ContextPartKind": agent_ContextPartKind;
  "agent/ContextPeer": agent_ContextPeer;
  "agent/ContextSelf": agent_ContextSelf;
  "agent/ContextTodo": agent_ContextTodo;
  "agent/ConversationCard": agent_ConversationCard;
  "agent/ConversationOverview": agent_ConversationOverview;
  "agent/CreateWorkstreamParams": agent_CreateWorkstreamParams;
  "agent/Digest": agent_Digest;
  "agent/DigestEntry": agent_DigestEntry;
  "agent/DigestItem": agent_DigestItem;
  "agent/Extras": agent_Extras;
  "agent/ExtrasAddParams": agent_ExtrasAddParams;
  "agent/FileComparison": agent_FileComparison;
  "agent/FileContent": agent_FileContent;
  "agent/Inbox": agent_Inbox;
  "agent/Instruction": agent_Instruction;
  "agent/InstructionDelivery": agent_InstructionDelivery;
  "agent/InstructionRevision": agent_InstructionRevision;
  "agent/InstructionState": agent_InstructionState;
  "agent/Instructions": agent_Instructions;
  "agent/KeptItem": agent_KeptItem;
  "agent/KeptReason": agent_KeptReason;
  "agent/Landed": agent_Landed;
  "agent/MoveParams": agent_MoveParams;
  "agent/NodeId": agent_NodeId;
  "agent/NodeKind": agent_NodeKind;
  "agent/Order": agent_Order;
  "agent/ParentNode": agent_ParentNode;
  "agent/PermissionMode": agent_PermissionMode;
  "agent/PromptParams": agent_PromptParams;
  "agent/RailNode": agent_RailNode;
  "agent/Removal": agent_Removal;
  "agent/RemovalKind": agent_RemovalKind;
  "agent/RemovedItem": agent_RemovedItem;
  "agent/RenameParams": agent_RenameParams;
  "agent/ResumeMode": agent_ResumeMode;
  "agent/ResumeParams": agent_ResumeParams;
  "agent/RunParams": agent_RunParams;
  "agent/SetModelParams": agent_SetModelParams;
  "agent/SetOrderParams": agent_SetOrderParams;
  "agent/SignalOutcome": agent_SignalOutcome;
  "agent/SignalParams": agent_SignalParams;
  "agent/Skill": agent_Skill;
  "agent/Skills": agent_Skills;
  "agent/SpawnParams": agent_SpawnParams;
  "agent/StartDoorParams": agent_StartDoorParams;
  "agent/StatusEvent": agent_StatusEvent;
  "agent/Stray": agent_Stray;
  "agent/StrayEvent": agent_StrayEvent;
  "agent/ToolCall": agent_ToolCall;
  "agent/ToolCallEvent": agent_ToolCallEvent;
  "agent/ToolCallState": agent_ToolCallState;
  "agent/WakeParams": agent_WakeParams;
  "agent/Woken": agent_Woken;
  "agent/Worktree": agent_Worktree;
  "agent/WorktreeCheckConclusion": agent_WorktreeCheckConclusion;
  "agent/WorktreeCi": agent_WorktreeCi;
  "agent/WorktreeCiState": agent_WorktreeCiState;
  "agent/WorktreeEvidence": agent_WorktreeEvidence;
  "agent/WorktreeEvidenceState": agent_WorktreeEvidenceState;
  "agent/WorktreePr": agent_WorktreePr;
  "agent/WorktreeRequiredCheck": agent_WorktreeRequiredCheck;
  "agent/WorktreeState": agent_WorktreeState;
  "ask/Ask": ask_Ask;
  "ask/AskPart": ask_AskPart;
  "ask/PickParams": ask_PickParams;
  "ask/Placement": ask_Placement;
  "ask/SendParams": ask_SendParams;
  "ask/State": ask_State;
  "ask/Target": ask_Target;
  "attachment/SaveParams": attachment_SaveParams;
  "attachment/Saved": attachment_Saved;
  "deliverable/Deliverable": deliverable_Deliverable;
  "deliverable/DeliverableId": deliverable_DeliverableId;
  "deliverable/ExternalAvailability": deliverable_ExternalAvailability;
  "deliverable/ListParams": deliverable_ListParams;
  "deliverable/MoveParams": deliverable_MoveParams;
  "deliverable/PublicationTarget": deliverable_PublicationTarget;
  "deliverable/PublishParams": deliverable_PublishParams;
  "deliverable/PublishedTarget": deliverable_PublishedTarget;
  "deliverable/Resolution": deliverable_Resolution;
  "deliverable/UnavailableCause": deliverable_UnavailableCause;
  "link/LinkContent": link_LinkContent;
  "link/LinkUrl": link_LinkUrl;
  "link/Section": link_Section;
  "message/AcceptResultParams": message_AcceptResultParams;
  "message/ContinuationAction": message_ContinuationAction;
  "message/ContinuationBlock": message_ContinuationBlock;
  "message/ContinuationChoice": message_ContinuationChoice;
  "message/ContinuationContext": message_ContinuationContext;
  "message/Delivery": message_Delivery;
  "message/ListParams": message_ListParams;
  "message/Message": message_Message;
  "message/MessageId": message_MessageId;
  "message/MessageKind": message_MessageKind;
  "message/MessageStatus": message_MessageStatus;
  "message/Progress": message_Progress;
  "message/ProgressParams": message_ProgressParams;
  "message/Reason": message_Reason;
  "message/Reconciliation": message_Reconciliation;
  "message/ReportParams": message_ReportParams;
  "message/ResolveResultParams": message_ResolveResultParams;
  "message/ResultAcceptance": message_ResultAcceptance;
  "message/ResultCheck": message_ResultCheck;
  "message/ResultId": message_ResultId;
  "message/ResultObservation": message_ResultObservation;
  "message/ResultOutcome": message_ResultOutcome;
  "message/ResultProgress": message_ResultProgress;
  "message/ResultReport": message_ResultReport;
  "message/ResultResolution": message_ResultResolution;
  "message/ResultState": message_ResultState;
  "message/ResultTarget": message_ResultTarget;
  "message/ResumeWork": message_ResumeWork;
  "message/ResumeWorkParams": message_ResumeWorkParams;
  "message/Route": message_Route;
  "message/SendParams": message_SendParams;
  "message/SetRouteParams": message_SetRouteParams;
  "pad/AppendParams": pad_AppendParams;
  "pad/AppendSectionParams": pad_AppendSectionParams;
  "pad/CreateParams": pad_CreateParams;
  "pad/DeleteParams": pad_DeleteParams;
  "pad/Deletion": pad_Deletion;
  "pad/DeletionId": pad_DeletionId;
  "pad/GetDeletionParams": pad_GetDeletionParams;
  "pad/ExportParams": pad_ExportParams;
  "pad/MoveParams": pad_MoveParams;
  "pad/Pad": pad_Pad;
  "pad/PadName": pad_PadName;
  "pad/RenameParams": pad_RenameParams;
  "pad/SetStorageParams": pad_SetStorageParams;
  "pad/WriteParams": pad_WriteParams;
  "project/AgentResources": project_AgentResources;
  "project/Choice": project_Choice;
  "project/ImportCandidate": project_ImportCandidate;
  "project/ImportCommitParams": project_ImportCommitParams;
  "project/ImportDiscoverParams": project_ImportDiscoverParams;
  "project/ImportDiscovery": project_ImportDiscovery;
  "project/ImportDisposition": project_ImportDisposition;
  "project/ImportExclusion": project_ImportExclusion;
  "project/ImportExclusionCause": project_ImportExclusionCause;
  "project/ImportFailure": project_ImportFailure;
  "project/ImportList": project_ImportList;
  "project/ImportListParams": project_ImportListParams;
  "project/ImportListed": project_ImportListed;
  "project/ImportLive": project_ImportLive;
  "project/ImportOutcome": project_ImportOutcome;
  "project/ImportPeriod": project_ImportPeriod;
  "project/ImportResult": project_ImportResult;
  "project/ImportSelection": project_ImportSelection;
  "project/Mcp": project_Mcp;
  "project/ModelList": project_ModelList;
  "project/OpenParams": project_OpenParams;
  "project/PrepareParams": project_PrepareParams;
  "project/Prepared": project_Prepared;
  "project/ProjectModels": project_ProjectModels;
  "project/ProjectSettings": project_ProjectSettings;
  "project/RenameParams": project_RenameParams;
  "project/Requested": project_Requested;
  "project/ResourceTotal": project_ResourceTotal;
  "project/Resources": project_Resources;
  "project/RoleModels": project_RoleModels;
  "project/Worktrees": project_Worktrees;
  "reaction/Condition": reaction_Condition;
  "reaction/CreateParams": reaction_CreateParams;
  "reaction/Firing": reaction_Firing;
  "reaction/LatePolicy": reaction_LatePolicy;
  "reaction/Observation": reaction_Observation;
  "reaction/ObservationCause": reaction_ObservationCause;
  "reaction/ObservationGap": reaction_ObservationGap;
  "reaction/ObservationHealth": reaction_ObservationHealth;
  "reaction/ObservationRecovery": reaction_ObservationRecovery;
  "reaction/Preview": reaction_Preview;
  "reaction/PreviewParams": reaction_PreviewParams;
  "reaction/Reaction": reaction_Reaction;
  "reaction/ReactionId": reaction_ReactionId;
  "reaction/RunParams": reaction_RunParams;
  "reaction/State": reaction_State;
  "terminal/ExitedEvent": terminal_ExitedEvent;
  "terminal/Match": terminal_Match;
  "terminal/OpenParams": terminal_OpenParams;
  "terminal/Opened": terminal_Opened;
  "terminal/OutputEvent": terminal_OutputEvent;
  "terminal/OutputGap": terminal_OutputGap;
  "terminal/OutputStarted": terminal_OutputStarted;
  "terminal/Read": terminal_Read;
  "terminal/ReadParams": terminal_ReadParams;
  "terminal/ResizeParams": terminal_ResizeParams;
  "terminal/Scheme": terminal_Scheme;
  "terminal/SchemeParams": terminal_SchemeParams;
  "terminal/Screen": terminal_Screen;
  "terminal/Search": terminal_Search;
  "terminal/SearchParams": terminal_SearchParams;
  "terminal/Snapshot": terminal_Snapshot;
  "terminal/SpawnParams": terminal_SpawnParams;
  "terminal/TerminalId": terminal_TerminalId;
  "terminal/TerminalInfo": terminal_TerminalInfo;
  "terminal/TitleEvent": terminal_TitleEvent;
  "terminal/WriteParams": terminal_WriteParams;
  "todo/AssignParams": todo_AssignParams;
  "todo/Change": todo_Change;
  "todo/Comment": todo_Comment;
  "todo/CommentParams": todo_CommentParams;
  "todo/CreateParams": todo_CreateParams;
  "todo/HandParams": todo_HandParams;
  "todo/Handed": todo_Handed;
  "todo/History": todo_History;
  "todo/MoveParams": todo_MoveParams;
  "todo/ReadHistoryParams": todo_ReadHistoryParams;
  "todo/Ref": todo_Ref;
  "todo/RefParams": todo_RefParams;
  "todo/RefState": todo_RefState;
  "todo/ReorderParams": todo_ReorderParams;
  "todo/SetBlockersParams": todo_SetBlockersParams;
  "todo/Todo": todo_Todo;
  "todo/TodoId": todo_TodoId;
  "todo/DeleteParams": todo_DeleteParams;
  "todo/DeletionParams": todo_DeletionParams;
  "todo/DeletionState": todo_DeletionState;
  "todo/Deletion": todo_Deletion;
  "todo/UnreadComment": todo_UnreadComment;
  "todo/UpdateParams": todo_UpdateParams;
  "todo/Values": todo_Values;
  "workstream/AutoParams": workstream_AutoParams;
  "workstream/CapParams": workstream_CapParams;
  "workstream/QueueEntry": workstream_QueueEntry;
  "workstream/QueueFailure": workstream_QueueFailure;
  "workstream/QueueMoveParams": workstream_QueueMoveParams;
  "workstream/QueueState": workstream_QueueState;
  "workstream/QueuedWorkstream": workstream_QueuedWorkstream;
  "workstream/StartChoice": workstream_StartChoice;
  "workstream/StartWorkstreamParams": workstream_StartWorkstreamParams;
};

export type BeforeRpcMethods = {
  "deliverable.publish": { params: deliverable_PublishParams; result: deliverable_Deliverable };
  "deliverable.list": { params: deliverable_ListParams; result: deliverable_Deliverable[] };
  "deliverable.get": { params: deliverable_DeliverableId; result: deliverable_Deliverable };
  "deliverable.resolve": { params: deliverable_DeliverableId; result: deliverable_Resolution };
  "deliverable.move": { params: deliverable_MoveParams; result: deliverable_Deliverable };
  "deliverable.remove": { params: deliverable_DeliverableId; result: null };
  "ask.send": { params: ask_SendParams; result: ask_Ask };
  "ask.list": { params: null; result: ask_Ask[] };
  "ask.pick": { params: ask_PickParams; result: ask_Ask };
  "daemon.ping": { params: null; result: { pong: true, pid: number, project: string, projectKey: string, contract: { fingerprint: string } } };
  "daemon.methods": { params: null; result: string[] };
  "link.read": { params: link_LinkUrl; result: link_LinkContent };
  "daemon.identify": { params: IdentifyParams; result: null };
  "events.subscribe": { params: SubscribeParams | null; result: SubscribeResult };
  "provenance.history": { params: HistoryParams; result: Touch[] };
  "provenance.touched": { params: TouchedParams; result: Touch[] };
  "terminal.spawn": { params: terminal_SpawnParams; result: terminal_TerminalId };
  "terminal.open": { params: terminal_OpenParams; result: terminal_Opened };
  "terminal.close": { params: terminal_TerminalId; result: null };
  "terminal.write": { params: terminal_WriteParams; result: null };
  "terminal.resize": { params: terminal_ResizeParams; result: null };
  "terminal.kill": { params: terminal_TerminalId; result: null };
  "terminal.scheme": { params: terminal_SchemeParams; result: null };
  "terminal.show": { params: terminal_TerminalId; result: null };
  "terminal.list": { params: null; result: terminal_TerminalInfo[] };
  "terminal.snapshot": { params: terminal_TerminalId; result: terminal_Snapshot };
  "terminal.output": { params: terminal_TerminalId; result: terminal_OutputStarted };
  "terminal.outputStop": { params: terminal_TerminalId; result: null };
  "terminal.screen": { params: terminal_TerminalId; result: terminal_Screen };
  "terminal.read": { params: terminal_ReadParams; result: terminal_Read };
  "terminal.search": { params: terminal_SearchParams; result: terminal_Search };
  "todo.create": { params: todo_CreateParams; result: todo_Todo };
  "todo.get": { params: todo_TodoId; result: todo_Todo };
  "todo.listHanded": { params: null; result: todo_Handed[] };
  "todo.getHistory": { params: todo_TodoId; result: todo_History };
  "todo.readHistory": { params: todo_ReadHistoryParams; result: null };
  "todo.list": { params: null; result: todo_Todo[] };
  "todo.update": { params: todo_UpdateParams; result: todo_Todo };
  "todo.complete": { params: todo_TodoId; result: todo_Todo };
  "todo.reopen": { params: todo_TodoId; result: todo_Todo };
  "todo.setBlockers": { params: todo_SetBlockersParams; result: todo_Todo };
  "todo.assign": { params: todo_AssignParams; result: todo_Todo };
  "todo.hand": { params: todo_HandParams; result: todo_Todo | null };
  "todo.move": { params: todo_MoveParams; result: todo_Todo };
  "todo.reorder": { params: todo_ReorderParams; result: todo_Todo };
  "todo.delete": { params: todo_DeleteParams; result: todo_Deletion };
  "todo.deletion": { params: todo_DeletionParams; result: todo_Deletion | null };
  "todo.restore": { params: todo_DeletionParams; result: todo_Deletion };
  "todo.comment": { params: todo_CommentParams; result: todo_Comment };
  "todo.comments": { params: todo_TodoId; result: todo_Comment[] };
  "todo.unread": { params: null; result: todo_UnreadComment[] };
  "todo.markCommentsRead": { params: todo_TodoId; result: null };
  "todo.addRef": { params: todo_RefParams; result: todo_Todo };
  "todo.removeRef": { params: todo_RefParams; result: todo_Todo };
  "todo.refs": { params: todo_TodoId; result: todo_Ref[] };
  "pad.create": { params: pad_CreateParams; result: pad_Pad };
  "pad.read": { params: pad_PadName; result: pad_Pad };
  "pad.list": { params: null; result: pad_Pad[] };
  "pad.rename": { params: pad_RenameParams; result: pad_Pad };
  "pad.write": { params: pad_WriteParams; result: pad_Pad };
  "pad.append": { params: pad_AppendParams; result: pad_Pad };
  "pad.appendSection": { params: pad_AppendSectionParams; result: pad_Pad };
  "pad.move": { params: pad_MoveParams; result: pad_Pad };
  "pad.delete": { params: pad_DeleteParams; result: pad_Deletion };
  "pad.getDeletion": { params: pad_GetDeletionParams; result: pad_Deletion };
  "pad.restore": { params: pad_DeletionId; result: pad_Deletion };
  "pad.export": { params: pad_ExportParams; result: null };
  "pad.setStorage": { params: pad_SetStorageParams; result: null };
  "agent.spawn": { params: agent_SpawnParams; result: agent_RailNode };
  "agent.extras": { params: null; result: agent_Extras };
  "agent.extras_add": { params: agent_ExtrasAddParams; result: agent_RailNode };
  "agent.stop": { params: agent_NodeId; result: null };
  "agent.prompt": { params: agent_PromptParams; result: null };
  "agent.interrupt": { params: agent_NodeId; result: null };
  "agent.worktreeState": { params: agent_NodeId; result: agent_WorktreeState };
  "agent.changedFiles": { params: agent_NodeId; result: agent_ChangedFiles };
  "agent.compareFile": { params: agent_CompareFileParams; result: agent_FileComparison };
  "agent.land": { params: agent_NodeId; result: agent_Landed };
  "agent.discard": { params: agent_NodeId; result: null };
  "agent.context": { params: agent_NodeId; result: agent_Context };
  "agent.brief": { params: agent_NodeId; result: agent_Brief };
  "agent.skills": { params: agent_NodeId; result: agent_Skills };
  "agent.digest": { params: agent_NodeId; result: agent_Digest };
  "agent.wake": { params: agent_WakeParams; result: agent_Woken };
  "reaction.create": { params: reaction_CreateParams; result: reaction_Reaction };
  "reaction.preview": { params: reaction_PreviewParams; result: reaction_Preview };
  "reaction.list": { params: null; result: reaction_Reaction[] };
  "reaction.get": { params: reaction_ReactionId; result: reaction_Reaction };
  "reaction.stop": { params: reaction_ReactionId; result: reaction_Reaction };
  "reaction.run": { params: reaction_RunParams; result: reaction_Reaction };
  "agent.spawnPrompt": { params: agent_NodeId; result: { prompt: string | null } };
  "agent.setOrder": { params: agent_SetOrderParams; result: agent_RailNode };
  "agent.instructions": { params: agent_NodeId; result: agent_Instructions };
  "agent.channelUp": { params: agent_NodeId; result: null };
  "agent.signal": { params: agent_SignalParams; result: agent_SignalOutcome | null };
  "rail.tree": { params: null; result: agent_RailNode[] };
  "rail.list": { params: null; result: agent_RailNode[] };
  "workstream.setAuto": { params: workstream_AutoParams; result: null };
  "rail.createWorkstream": { params: agent_CreateWorkstreamParams; result: agent_RailNode };
  "rail.move": { params: agent_MoveParams; result: null };
  "rail.rename": { params: agent_RenameParams; result: agent_RailNode };
  "rail.startDoor": { params: agent_StartDoorParams; result: agent_RailNode };
  "agent.run": { params: agent_RunParams; result: terminal_Opened };
  "project.setWorktrees": { params: project_Worktrees; result: null };
  "project.setMcp": { params: project_Mcp; result: null };
  "project.setPrepared": { params: project_Prepared; result: null };
  "project.getPrepared": { params: null; result: project_Prepared };
  "project.importDiscover": { params: project_ImportDiscoverParams; result: project_ImportDiscovery };
  "import.list": { params: project_ImportListParams; result: project_ImportList };
  "project.importCommit": { params: project_ImportCommitParams; result: project_ImportResult };
  "project.prepareDirectory": { params: project_PrepareParams; result: null };
  "project.get": { params: null; result: project_ProjectSettings };
  "project.setModels": { params: project_ProjectModels; result: null };
  "models.list": { params: null; result: project_ModelList };
  "project.resources": { params: null; result: project_Resources };
  "project.open": { params: project_OpenParams; result: null };
  "project.rename": { params: project_RenameParams; result: null };
  "attachment.save": { params: attachment_SaveParams; result: attachment_Saved };
  "message.progress": { params: message_ProgressParams; result: message_Progress };
  "message.report": { params: message_ReportParams; result: message_ResultReport };
  "message.acceptResult": { params: message_AcceptResultParams; result: message_ResultAcceptance };
  "message.verifyResult": { params: message_ResultId; result: message_ResultObservation };
  "message.resolveResult": { params: message_ResolveResultParams; result: message_ResultObservation };
  "message.reconcileWork": { params: message_ProgressParams; result: message_Reconciliation };
  "message.resumeWork": { params: message_ResumeWorkParams; result: message_ResumeWork };
  "message.send": { params: message_SendParams; result: message_Message };
  "message.get": { params: message_MessageId; result: message_Message };
  "message.list": { params: message_ListParams; result: message_Message[] };
  "message.drop": { params: message_MessageId; result: message_Message };
  "route.set": { params: message_SetRouteParams; result: message_Route };
  "route.list": { params: null; result: message_Route[] };
  "rail.remove": { params: agent_NodeId; result: agent_Removal | null };
  "agent.resume": { params: agent_ResumeParams; result: agent_RailNode };
  "agent.setModel": { params: agent_SetModelParams; result: agent_RailNode };
  "todo.startWorkstream": { params: workstream_StartWorkstreamParams; result: agent_RailNode };
  "workstream.queue": { params: null; result: workstream_QueueState };
  "workstream.dequeue": { params: workstream_QueuedWorkstream; result: null };
  "workstream.queueMove": { params: workstream_QueueMoveParams; result: null };
  "workstream.startNow": { params: workstream_QueuedWorkstream; result: agent_RailNode };
  "project.setWorkstreamCap": { params: workstream_CapParams; result: null };
};

export type RpcMethodName = keyof BeforeRpcMethods;
