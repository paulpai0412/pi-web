export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type NorthstarWizardPhase = "plan" | "setup" | "execute" | "monitor" | "recovery" | "report";
export type NorthstarHostAdapter = "codex" | "opencode" | "pi";
export type NorthstarLifecycleState =
  | "ready"
  | "claimed"
  | "running"
  | "verifying"
  | "verified"
  | "release_pending"
  | "completed"
  | "cancelled"
  | "failed"
  | "quarantined";

export interface NorthstarProjectSummary {
  id?: string;
  projectId: string;
  name: string;
  root: string;
  repo: string;
  hostAdapter: NorthstarHostAdapter;
  configPath: string;
  runtimeDbPath: string;
}

export interface NorthstarBoard {
  project: NorthstarProjectSummary;
  groups: NorthstarBoardGroup[];
}

export interface NorthstarBoardGroup {
  lifecycle: NorthstarLifecycleState;
  cards: NorthstarBoardCard[];
}

export interface NorthstarBoardCard {
  issueId: string;
  issueNumber: string | null;
  title: string;
  lifecycle: NorthstarLifecycleState;
  currentStage: string | null;
  latestHostAdapter: NorthstarHostAdapter | null;
  dependencyCount: number;
  blocked: boolean;
  prUrl: string | null;
  mergeSha: string | null;
  latestRootSessionId: string | null;
  latestChildRunId: string | null;
  lastHeartbeatAt: string | null;
  nextRecommendedAction: string;
  projectionFailure: boolean;
}

export interface NorthstarRunEvent {
  id: string;
  sequence: number;
  eventType: string;
  severity: "info" | "warning" | "error";
  createdAt: string | null;
  summary: string;
  payloadPreview: JsonValue;
}

export interface NorthstarSessionLink {
  host: NorthstarHostAdapter;
  rootSessionId: string;
  childRunId: string;
  sessionId: string;
  href: string | null;
}

export interface NorthstarAcceptedArtifact {
  historyId: number;
  artifactHistoryId?: number;
  artifact_history_id?: JsonValue;
  kind: string;
  summary: string;
}

export interface NorthstarIssueDetail {
  snapshot: JsonObject;
  title: string;
  sourceUrl: string | null;
  labels: string[];
  inspect: JsonObject;
  timeline: NorthstarRunEvent[];
  sessionLinks: NorthstarSessionLink[];
  acceptedArtifacts: NorthstarAcceptedArtifact[];
}

export interface NorthstarWizardState {
  projectId: string;
  currentPhase: NorthstarWizardPhase;
  phases: NorthstarWizardPhaseState[];
  selectedOptions: JsonObject;
  commandPlans: NorthstarCommandPlan[];
  confirmationGates: NorthstarConfirmationGate[];
  evidence: NorthstarWizardEvidence[];
  nextRecommendedAction: string | null;
}

export interface NorthstarWizardPhaseState {
  phase: NorthstarWizardPhase;
  status: "not_started" | "ready" | "waiting_for_confirmation" | "running" | "completed" | "blocked";
  summary: string;
  requiredInputs: string[];
  completedChecks: string[];
  blockers: string[];
}

export interface NorthstarCommandPlan {
  id: string;
  phase: NorthstarWizardPhase;
  description: string;
  argv: string[];
  expectedEffects: string[];
  risk: "low" | "medium" | "high";
  requiresConfirmation: boolean;
}

export interface NorthstarConfirmationGate {
  id: string;
  phase: NorthstarWizardPhase;
  title: string;
  reason: string;
  commandPlanIds: string[];
  status: "open" | "approved" | "rejected";
}

export interface NorthstarWizardEvidence {
  phase: NorthstarWizardPhase;
  kind: "doctor" | "config" | "github" | "project" | "runtime" | "verification" | "recovery" | "report";
  summary: string;
  links: Array<{ label: string; url: string }>;
  payloadPreview: JsonValue;
}

