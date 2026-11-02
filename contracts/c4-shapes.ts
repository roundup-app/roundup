import type { Before, BeforeRpcMethods } from "./c4-before";

type After = {
  "Actor": import("./generated/Actor").Actor;
  "ActorKind": import("./generated/ActorKind").ActorKind;
  "Event": import("./generated/Event").Event;
  "EventData": import("./generated/EventData").EventData;
  "HistoryParams": import("./generated/HistoryParams").HistoryParams;
  "IdentifyParams": import("./generated/IdentifyParams").IdentifyParams;
  "Kind": import("./generated/Kind").Kind;
  "RpcErrorData": import("./generated/RpcErrorData").RpcErrorData;
  "Status": import("./generated/Status").Status;
  "SubscribeParams": import("./generated/SubscribeParams").SubscribeParams;
  "SubscribeResult": import("./generated/SubscribeResult").SubscribeResult;
  "Touch": import("./generated/Touch").Touch;
  "TouchedParams": import("./generated/TouchedParams").TouchedParams;
  "Verb": import("./generated/Verb").Verb;
  "agent/Brief": import("./generated/agent/Brief").Brief;
  "agent/CapturedOrder": import("./generated/agent/CapturedOrder").CapturedOrder;
  "agent/ChangedFile": import("./generated/agent/ChangedFile").ChangedFile;
  "agent/ChangedFiles": import("./generated/agent/ChangedFiles").ChangedFiles;
  "agent/ChangedStatus": import("./generated/agent/ChangedStatus").ChangedStatus;
  "agent/Channel": import("./generated/agent/Channel").Channel;
  "agent/ChannelEvent": import("./generated/agent/ChannelEvent").ChannelEvent;
  "agent/CompareFileParams": import("./generated/agent/CompareFileParams").CompareFileParams;
  "agent/Context": import("./generated/agent/Context").Context;
  "agent/ContextAsk": import("./generated/agent/ContextAsk").ContextAsk;
  "agent/ContextParent": import("./generated/agent/ContextParent").ContextParent;
  "agent/ContextPart": import("./generated/agent/ContextPart").ContextPart;
  "agent/ContextPartKind": import("./generated/agent/ContextPartKind").ContextPartKind;
  "agent/ContextPeer": import("./generated/agent/ContextPeer").ContextPeer;
  "agent/ContextSelf": import("./generated/agent/ContextSelf").ContextSelf;
  "agent/ContextTodo": import("./generated/agent/ContextTodo").ContextTodo;
  "agent/ConversationCard": import("./generated/agent/ConversationCard").ConversationCard;
  "agent/ConversationOverview": import("./generated/agent/ConversationOverview").ConversationOverview;
  "agent/CreateWorkstreamParams": import("./generated/agent/CreateWorkstreamParams").CreateWorkstreamParams;
  "agent/Digest": import("./generated/agent/Digest").Digest;
  "agent/DigestEntry": import("./generated/agent/DigestEntry").DigestEntry;
  "agent/DigestItem": import("./generated/agent/DigestItem").DigestItem;
  "agent/Extras": import("./generated/agent/Extras").Extras;
  "agent/ExtrasAddParams": import("./generated/agent/ExtrasAddParams").ExtrasAddParams;
  "agent/FileComparison": import("./generated/agent/FileComparison").FileComparison;
  "agent/FileContent": import("./generated/agent/FileContent").FileContent;
  "agent/Inbox": import("./generated/agent/Inbox").Inbox;
  "agent/Instruction": import("./generated/agent/Instruction").Instruction;
  "agent/InstructionDelivery": import("./generated/agent/InstructionDelivery").InstructionDelivery;
  "agent/InstructionRevision": import("./generated/agent/InstructionRevision").InstructionRevision;
  "agent/InstructionState": import("./generated/agent/InstructionState").InstructionState;
  "agent/Instructions": import("./generated/agent/Instructions").Instructions;
  "agent/KeptItem": import("./generated/agent/KeptItem").KeptItem;
  "agent/KeptReason": import("./generated/agent/KeptReason").KeptReason;
  "agent/Landed": import("./generated/agent/Landed").Landed;
  "agent/MoveParams": import("./generated/agent/MoveParams").MoveParams;
  "agent/NodeId": import("./generated/agent/NodeId").NodeId;
  "agent/NodeKind": import("./generated/agent/NodeKind").NodeKind;
  "agent/Order": import("./generated/agent/Order").Order;
  "agent/ParentNode": import("./generated/agent/ParentNode").ParentNode;
  "agent/PermissionMode": import("./generated/agent/PermissionMode").PermissionMode;
  "agent/PromptParams": import("./generated/agent/PromptParams").PromptParams;
  "agent/RailNode": import("./generated/agent/RailNode").RailNode;
  "agent/Removal": import("./generated/agent/Removal").Removal;
  "agent/RemovalKind": import("./generated/agent/RemovalKind").RemovalKind;
  "agent/RemovedItem": import("./generated/agent/RemovedItem").RemovedItem;
  "agent/RenameParams": import("./generated/agent/RenameParams").RenameParams;
  "agent/ResumeMode": import("./generated/agent/ResumeMode").ResumeMode;
  "agent/ResumeParams": import("./generated/agent/ResumeParams").ResumeParams;
  "agent/RunParams": import("./generated/agent/RunParams").RunParams;
  "agent/SetModelParams": import("./generated/agent/SetModelParams").SetModelParams;
  "agent/SetOrderParams": import("./generated/agent/SetOrderParams").SetOrderParams;
  "agent/SignalOutcome": import("./generated/agent/SignalOutcome").SignalOutcome;
  "agent/SignalParams": import("./generated/agent/SignalParams").SignalParams;
  "agent/Skill": import("./generated/agent/Skill").Skill;
  "agent/Skills": import("./generated/agent/Skills").Skills;
  "agent/SpawnParams": import("./generated/agent/SpawnParams").SpawnParams;
  "agent/StartDoorParams": import("./generated/agent/StartDoorParams").StartDoorParams;
  "agent/StatusEvent": import("./generated/agent/StatusEvent").StatusEvent;
  "agent/Stray": import("./generated/agent/Stray").Stray;
  "agent/StrayEvent": import("./generated/agent/StrayEvent").StrayEvent;
  "agent/ToolCall": import("./generated/agent/ToolCall").ToolCall;
  "agent/ToolCallEvent": import("./generated/agent/ToolCallEvent").ToolCallEvent;
  "agent/ToolCallState": import("./generated/agent/ToolCallState").ToolCallState;
  "agent/WakeParams": import("./generated/agent/WakeParams").WakeParams;
  "agent/Woken": import("./generated/agent/Woken").Woken;
  "agent/Worktree": import("./generated/agent/Worktree").Worktree;
  "agent/WorktreeCheckConclusion": import("./generated/agent/WorktreeCheckConclusion").WorktreeCheckConclusion;
  "agent/WorktreeCi": import("./generated/agent/WorktreeCi").WorktreeCi;
  "agent/WorktreeCiState": import("./generated/agent/WorktreeCiState").WorktreeCiState;
  "agent/WorktreeEvidence": import("./generated/agent/WorktreeEvidence").WorktreeEvidence;
  "agent/WorktreeEvidenceState": import("./generated/agent/WorktreeEvidenceState").WorktreeEvidenceState;
  "agent/WorktreePr": import("./generated/agent/WorktreePr").WorktreePr;
  "agent/WorktreeRequiredCheck": import("./generated/agent/WorktreeRequiredCheck").WorktreeRequiredCheck;
  "agent/WorktreeState": import("./generated/agent/WorktreeState").WorktreeState;
  "ask/Ask": import("./generated/ask/Ask").Ask;
  "ask/AskPart": import("./generated/ask/AskPart").AskPart;
  "ask/PickParams": import("./generated/ask/PickParams").PickParams;
  "ask/Placement": import("./generated/ask/Placement").Placement;
  "ask/SendParams": import("./generated/ask/SendParams").SendParams;
  "ask/State": import("./generated/ask/State").State;
  "ask/Target": import("./generated/ask/Target").Target;
  "deliverable/Deliverable": import("./generated/deliverable/Deliverable").Deliverable;
  "deliverable/DeliverableId": import("./generated/deliverable/DeliverableId").DeliverableId;
  "deliverable/ExternalAvailability": import("./generated/deliverable/ExternalAvailability").ExternalAvailability;
  "deliverable/ListParams": import("./generated/deliverable/ListParams").ListParams;
  "deliverable/MoveParams": import("./generated/deliverable/MoveParams").MoveParams;
  "deliverable/PublicationTarget": import("./generated/deliverable/PublicationTarget").PublicationTarget;
  "deliverable/PublishParams": import("./generated/deliverable/PublishParams").PublishParams;
  "deliverable/PublishedTarget": import("./generated/deliverable/PublishedTarget").PublishedTarget;
  "deliverable/Resolution": import("./generated/deliverable/Resolution").Resolution;
  "deliverable/UnavailableCause": import("./generated/deliverable/UnavailableCause").UnavailableCause;
  "link/LinkContent": import("./generated/link/LinkContent").LinkContent;
  "link/LinkUrl": import("./generated/link/LinkUrl").LinkUrl;
  "link/Section": import("./generated/link/Section").Section;
  "message/AcceptResultParams": import("./generated/message/AcceptResultParams").AcceptResultParams;
  "message/ContinuationAction": import("./generated/message/ContinuationAction").ContinuationAction;
  "message/ContinuationBlock": import("./generated/message/ContinuationBlock").ContinuationBlock;
  "message/ContinuationChoice": import("./generated/message/ContinuationChoice").ContinuationChoice;
  "message/ContinuationContext": import("./generated/message/ContinuationContext").ContinuationContext;
  "message/Delivery": import("./generated/message/Delivery").Delivery;
  "message/ListParams": import("./generated/message/ListParams").ListParams;
  "message/Message": import("./generated/message/Message").Message;
  "message/MessageId": import("./generated/message/MessageId").MessageId;
  "message/MessageKind": import("./generated/message/MessageKind").MessageKind;
  "message/MessageStatus": import("./generated/message/MessageStatus").MessageStatus;
  "message/Progress": import("./generated/message/Progress").Progress;
  "message/ProgressParams": import("./generated/message/ProgressParams").ProgressParams;
  "message/Reason": import("./generated/message/Reason").Reason;
  "message/Reconciliation": import("./generated/message/Reconciliation").Reconciliation;
  "message/ReportParams": import("./generated/message/ReportParams").ReportParams;
  "message/ResolveResultParams": import("./generated/message/ResolveResultParams").ResolveResultParams;
  "message/ResultAcceptance": import("./generated/message/ResultAcceptance").ResultAcceptance;
  "message/ResultCheck": import("./generated/message/ResultCheck").ResultCheck;
  "message/ResultId": import("./generated/message/ResultId").ResultId;
  "message/ResultObservation": import("./generated/message/ResultObservation").ResultObservation;
  "message/ResultOutcome": import("./generated/message/ResultOutcome").ResultOutcome;
  "message/ResultProgress": import("./generated/message/ResultProgress").ResultProgress;
  "message/ResultReport": import("./generated/message/ResultReport").ResultReport;
  "message/ResultResolution": import("./generated/message/ResultResolution").ResultResolution;
  "message/ResultState": import("./generated/message/ResultState").ResultState;
  "message/ResultTarget": import("./generated/message/ResultTarget").ResultTarget;
  "message/ResumeWork": import("./generated/message/ResumeWork").ResumeWork;
  "message/ResumeWorkParams": import("./generated/message/ResumeWorkParams").ResumeWorkParams;
  "message/Route": import("./generated/message/Route").Route;
  "message/SendParams": import("./generated/message/SendParams").SendParams;
  "message/SetRouteParams": import("./generated/message/SetRouteParams").SetRouteParams;
  "pad/AppendParams": import("./generated/pad/AppendParams").AppendParams;
  "pad/AppendSectionParams": import("./generated/pad/AppendSectionParams").AppendSectionParams;
  "pad/CreateParams": import("./generated/pad/CreateParams").CreateParams;
  "pad/DeleteParams": import("./generated/pad/DeleteParams").DeleteParams;
  "pad/Deletion": import("./generated/pad/Deletion").Deletion;
  "pad/DeletionId": import("./generated/pad/DeletionId").DeletionId;
  "pad/GetDeletionParams": import("./generated/pad/GetDeletionParams").GetDeletionParams;
  "pad/ExportParams": import("./generated/pad/ExportParams").ExportParams;
  "pad/MoveParams": import("./generated/pad/MoveParams").MoveParams;
  "pad/Pad": import("./generated/pad/Pad").Pad;
  "pad/PadName": import("./generated/pad/PadName").PadName;
  "pad/RenameParams": import("./generated/pad/RenameParams").RenameParams;
  "pad/SetStorageParams": import("./generated/pad/SetStorageParams").SetStorageParams;
  "pad/WriteParams": import("./generated/pad/WriteParams").WriteParams;
  "project/AgentResources": import("./generated/project/AgentResources").AgentResources;
  "project/Choice": import("./generated/project/Choice").Choice;
  "project/ImportCandidate": import("./generated/project/ImportCandidate").ImportCandidate;
  "project/ImportCommitParams": import("./generated/project/ImportCommitParams").ImportCommitParams;
  "project/ImportDiscoverParams": import("./generated/project/ImportDiscoverParams").ImportDiscoverParams;
  "project/ImportDiscovery": import("./generated/project/ImportDiscovery").ImportDiscovery;
  "project/ImportDisposition": import("./generated/project/ImportDisposition").ImportDisposition;
  "project/ImportExclusion": import("./generated/project/ImportExclusion").ImportExclusion;
  "project/ImportExclusionCause": import("./generated/project/ImportExclusionCause").ImportExclusionCause;
  "project/ImportFailure": import("./generated/project/ImportFailure").ImportFailure;
  "project/ImportList": import("./generated/project/ImportList").ImportList;
  "project/ImportListParams": import("./generated/project/ImportListParams").ImportListParams;
  "project/ImportListed": import("./generated/project/ImportListed").ImportListed;
  "project/ImportLive": import("./generated/project/ImportLive").ImportLive;
  "project/ImportOutcome": import("./generated/project/ImportOutcome").ImportOutcome;
  "project/ImportPeriod": import("./generated/project/ImportPeriod").ImportPeriod;
  "project/ImportResult": import("./generated/project/ImportResult").ImportResult;
  "project/ImportSelection": import("./generated/project/ImportSelection").ImportSelection;
  "project/Mcp": import("./generated/project/Mcp").Mcp;
  "project/ModelList": import("./generated/project/ModelList").ModelList;
  "project/OpenParams": import("./generated/project/OpenParams").OpenParams;
  "project/PrepareParams": import("./generated/project/PrepareParams").PrepareParams;
  "project/Prepared": import("./generated/project/Prepared").Prepared;
  "project/ProjectModels": import("./generated/project/ProjectModels").ProjectModels;
  "project/ProjectSettings": import("./generated/project/ProjectSettings").ProjectSettings;
  "project/RenameParams": import("./generated/project/RenameParams").RenameParams;
  "project/Requested": import("./generated/project/Requested").Requested;
  "project/ResourceTotal": import("./generated/project/ResourceTotal").ResourceTotal;
  "project/Resources": import("./generated/project/Resources").Resources;
  "project/RoleModels": import("./generated/project/RoleModels").RoleModels;
  "project/Worktrees": import("./generated/project/Worktrees").Worktrees;
  "reaction/Condition": import("./generated/reaction/Condition").Condition;
  "reaction/CreateParams": import("./generated/reaction/CreateParams").CreateParams;
  "reaction/Firing": import("./generated/reaction/Firing").Firing;
  "reaction/LatePolicy": import("./generated/reaction/LatePolicy").LatePolicy;
  "reaction/Observation": import("./generated/reaction/Observation").Observation;
  "reaction/ObservationCause": import("./generated/reaction/ObservationCause").ObservationCause;
  "reaction/ObservationGap": import("./generated/reaction/ObservationGap").ObservationGap;
  "reaction/ObservationHealth": import("./generated/reaction/ObservationHealth").ObservationHealth;
  "reaction/ObservationRecovery": import("./generated/reaction/ObservationRecovery").ObservationRecovery;
  "reaction/Preview": import("./generated/reaction/Preview").Preview;
  "reaction/PreviewParams": import("./generated/reaction/PreviewParams").PreviewParams;
  "reaction/Reaction": import("./generated/reaction/Reaction").Reaction;
  "reaction/ReactionId": import("./generated/reaction/ReactionId").ReactionId;
  "reaction/RunParams": import("./generated/reaction/RunParams").RunParams;
  "reaction/State": import("./generated/reaction/State").State;
  "terminal/ExitedEvent": import("./generated/terminal/ExitedEvent").ExitedEvent;
  "terminal/Match": import("./generated/terminal/Match").Match;
  "terminal/OpenParams": import("./generated/terminal/OpenParams").OpenParams;
  "terminal/Opened": import("./generated/terminal/Opened").Opened;
  "terminal/OutputEvent": import("./generated/terminal/OutputEvent").OutputEvent;
  "terminal/OutputGap": import("./generated/terminal/OutputGap").OutputGap;
  "terminal/OutputStarted": import("./generated/terminal/OutputStarted").OutputStarted;
  "terminal/Read": import("./generated/terminal/Read").Read;
  "terminal/ReadParams": import("./generated/terminal/ReadParams").ReadParams;
  "terminal/ResizeParams": import("./generated/terminal/ResizeParams").ResizeParams;
  "terminal/Scheme": import("./generated/terminal/Scheme").Scheme;
  "terminal/SchemeParams": import("./generated/terminal/SchemeParams").SchemeParams;
  "terminal/Screen": import("./generated/terminal/Screen").Screen;
  "terminal/Search": import("./generated/terminal/Search").Search;
  "terminal/SearchParams": import("./generated/terminal/SearchParams").SearchParams;
  "terminal/Snapshot": import("./generated/terminal/Snapshot").Snapshot;
  "terminal/SpawnParams": import("./generated/terminal/SpawnParams").SpawnParams;
  "terminal/TerminalId": import("./generated/terminal/TerminalId").TerminalId;
  "terminal/TerminalInfo": import("./generated/terminal/TerminalInfo").TerminalInfo;
  "terminal/TerminalStatusEvent": import("./generated/terminal/TerminalStatusEvent").TerminalStatusEvent;
  "terminal/TitleEvent": import("./generated/terminal/TitleEvent").TitleEvent;
  "terminal/WriteParams": import("./generated/terminal/WriteParams").WriteParams;
  "todo/AssignParams": import("./generated/todo/AssignParams").AssignParams;
  "todo/Change": import("./generated/todo/Change").Change;
  "todo/Comment": import("./generated/todo/Comment").Comment;
  "todo/CommentParams": import("./generated/todo/CommentParams").CommentParams;
  "todo/CreateParams": import("./generated/todo/CreateParams").CreateParams;
  "todo/HandParams": import("./generated/todo/HandParams").HandParams;
  "todo/Handed": import("./generated/todo/Handed").Handed;
  "todo/History": import("./generated/todo/History").History;
  "todo/MoveParams": import("./generated/todo/MoveParams").MoveParams;
  "todo/ReadHistoryParams": import("./generated/todo/ReadHistoryParams").ReadHistoryParams;
  "todo/Ref": import("./generated/todo/Ref").Ref;
  "todo/RefParams": import("./generated/todo/RefParams").RefParams;
  "todo/RefState": import("./generated/todo/RefState").RefState;
  "todo/ReorderParams": import("./generated/todo/ReorderParams").ReorderParams;
  "todo/SetBlockersParams": import("./generated/todo/SetBlockersParams").SetBlockersParams;
  "todo/Todo": import("./generated/todo/Todo").Todo;
  "todo/TodoId": import("./generated/todo/TodoId").TodoId;
  "todo/DeleteParams": import("./generated/todo/DeleteParams").DeleteParams;
  "todo/DeletionParams": import("./generated/todo/DeletionParams").DeletionParams;
  "todo/DeletionState": import("./generated/todo/DeletionState").DeletionState;
  "todo/Deletion": import("./generated/todo/Deletion").Deletion;
  "todo/UnreadComment": import("./generated/todo/UnreadComment").UnreadComment;
  "todo/UpdateParams": import("./generated/todo/UpdateParams").UpdateParams;
  "todo/Values": import("./generated/todo/Values").Values;
  "workstream/AutoParams": import("./generated/workstream/AutoParams").AutoParams;
  "workstream/CapParams": import("./generated/workstream/CapParams").CapParams;
  "workstream/QueueEntry": import("./generated/workstream/QueueEntry").QueueEntry;
  "workstream/QueueFailure": import("./generated/workstream/QueueFailure").QueueFailure;
  "workstream/QueueMoveParams": import("./generated/workstream/QueueMoveParams").QueueMoveParams;
  "workstream/QueueState": import("./generated/workstream/QueueState").QueueState;
  "workstream/QueuedWorkstream": import("./generated/workstream/QueuedWorkstream").QueuedWorkstream;
  "workstream/StartChoice": import("./generated/workstream/StartChoice").StartChoice;
  "workstream/StartWorkstreamParams": import("./generated/workstream/StartWorkstreamParams").StartWorkstreamParams;
};

// U4593 widens only owner inputs; stored Actors and every other baseline field stay exact.
type WithOwnerSelector<T> = { [K in keyof T]: K extends "owner" ? T[K] | string : T[K] };

type SelectorInputs = "todo/AssignParams" | "todo/CreateParams";

// U5558 adds commit notifications; every existing Event and payload remains exact.
type AutomaticChanges = { name: "deliverable.changed" } | { name: "reaction.changed" };

// N5467b/NR11 retire nullable historical Reaction reasons; all other saved fields stay exact.
type CurrentReaction = Omit<Before["reaction/Reaction"], "reason"> & { reason: string };

type BeforeSelectors = { [K in keyof Before]: K extends SelectorInputs ? WithOwnerSelector<Before[K]>
  : K extends "EventData" ? Before[K] | AutomaticChanges
    : K extends "Event" ? Before[K] | (Pick<Before["Event"], "seq" | "actor"> & AutomaticChanges)
      : K extends "reaction/Reaction" ? CurrentReaction : Before[K] };

type SelectorMethods = "todo.assign" | "todo.create";

type BeforeMethodSelectors = { [K in keyof BeforeRpcMethods]: K extends SelectorMethods
  ? { params: WithOwnerSelector<BeforeRpcMethods[K]["params"]>; result: BeforeRpcMethods[K]["result"] }
  : K extends "reaction.create" | "reaction.get" | "reaction.run" | "reaction.stop"
    ? { params: BeforeRpcMethods[K]["params"]; result: CurrentReaction }
  : K extends "reaction.list"
    ? { params: BeforeRpcMethods[K]["params"]; result: CurrentReaction[] }
  : BeforeRpcMethods[K] };

// Both directions retain optionality, nulls, numeric types, tags and flattened fields.
type Assert<T extends true> = T;

export type C4ExportedContractsMatchExistingContracts = Assert<
  [After] extends [BeforeSelectors] ? ([BeforeSelectors] extends [After] ? true : false) : false
>;


type ExistingMethods = Pick<import("./generated/methods").RpcMethods, keyof BeforeRpcMethods>;

export type C4MethodContracts = Assert<
  [ExistingMethods] extends [BeforeMethodSelectors]
    ? ([BeforeMethodSelectors] extends [ExistingMethods] ? true : false) : false
>;

// Invalid callers must stay invalid, independently of the bidirectional comparison.
export type C4RejectMissingRequired = Assert<{} extends import("./generated/agent/SpawnParams").SpawnParams ? false : true>;

export type C4RejectInvalidNull = Assert<null extends import("./generated/agent/SpawnParams").SpawnParams["name"] ? false : true>;

export type C4RejectWrongDiscriminant = Assert<{kind: "missing"} extends import("./generated/agent/Order").Order ? false : true>;
