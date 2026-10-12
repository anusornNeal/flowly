import type { Lane, ReviewMode, Risk, QaVerdict } from './workflow.js';
import type { EngineeringRecord } from './engineering.js';

export type TargetPlatform = 'web' | 'desktop' | 'mobile';
export type Actor = { actor: string; channel: 'cli' | 'web' };
export type Project = {
 id: string; name: string; platform: TargetPlatform; baseUrl?: string; sourcePath?: string;
 uiContext: Record<string, unknown>; createdAt: string; updatedAt: string;
};
export type ChecklistItem = { id: string; text: string; done: boolean };
export type RiskFactors = {
 securityOrPermissions?: boolean; destructiveData?: boolean; schemaMigration?: boolean;
 publicContract?: boolean; sharedRuntimeConfig?: boolean; systemWide?: boolean; irreversible?: boolean;
 localScope?: boolean; reversible?: boolean; expectedOutcome?: boolean;
 acceptanceCriteria?: boolean; verificationStep?: boolean;
};
export type TaskRecord = {
 id: string; displayId: string; projectId: string; parentId?: string; originTaskId?: string;
 type: 'task' | 'bug'; title: string; description: string; status: Lane;
 priority: 'low' | 'medium' | 'high'; reviewMode: ReviewMode; reviewSkipReason?: string;
 risk: RiskFactors; acceptanceCriteria: string; verificationStep: string;
 checklist: ChecklistItem[]; childIds: string[];
 engineering?: EngineeringRecord;
 testsPassed: boolean; reviewApproved: boolean; currentReviewId?: string;
 createdAt: string; updatedAt: string; doneAt?: string;
};
export type BugThread = {
 id: string; projectId: string; taskId: string; origin: 'review' | 'visual_qa' | 'manual';
 fingerprint: string; title: string; description: string; status: 'open' | 'resolved';
 occurrences: Array<{ timestamp: string; actor: string; channel: string; detail: string; evidenceId?: string; caseId?: string }>;
 createdAt: string; updatedAt: string;
};
export type Viewport = { width: number; height: number; device: 'desktop' | 'tablet' | 'mobile' };
export type ScreenSpec = { id: string; name: string; stateId: string; route?: string; viewport: Viewport; required?: boolean; steps?: BrowserStep[] };
export type BrowserStep = { action: 'click' | 'fill' | 'press' | 'navigate' | 'select' | 'check'; selector?: string; value?: string; url?: string };
export type Preview = {
 id: string; projectId: string; taskId?: string; name: string;
 draft: { html: string; css: string; js: string; screens: ScreenSpec[]; contextSnapshot: Record<string,unknown> };
 revisionIds: string[]; approvedRevisionId?: string; createdAt: string; updatedAt: string;
};
export type PreviewRevision = {
 id: string; projectId: string; previewId: string; version: number;
 html: string; css: string; js: string; screens: ScreenSpec[];
 contextSnapshot: Record<string,unknown>; createdAt: string; approvedAt?: string; approvedBy?: string;
 approvedQuality?: {checkedAt:string;warnings:string[];acceptanceReason?:string;checkedScreenCount:number};
};
export type QaCaseHistory = {
 event: 'revision-superseded' | 'revision-archived' | 'screenshot-arrived' | 'verdict-changed' | 'waiver-cancelled';
 savedAt: string; revisionId: string; required: boolean; archived?: boolean;
 verdict?: QaVerdict; verdictReason?: string; verdictBy?: string; verdictAt?: string;
 evidenceId?: string; comparisonId?: string;
};
export type QaCase = {
 id: string; projectId: string; taskId: string; previewId: string; revisionId: string;
 screenId: string; stateId: string; viewport: Viewport; required: boolean;
 archived?: boolean; history?: QaCaseHistory[];
 verdict?: QaVerdict; verdictReason?: string; verdictBy?: string; verdictAt?: string;
 evidenceId?: string; comparisonId?: string; updatedAt: string;
};
export type Screenshot = {
 id: string; projectId: string; source: 'manual' | 'browser' | 'external'; mime: string;
 bytes: number; sha256: string; originalPath?: string; thumbnailPath?: string;
 sourceId?: string; captureId?: string; taskId?: string; screenId?: string;
 caseId?: string; intake?: {requestedTaskId?:string;requestedScreenId?:string;requestedStateId?:string;requestedCaseId?:string;reason?:string};
 status: 'active' | 'deleted'; createdAt: string; deletedAt?: string;
};
export type Comparison = {
 id: string; projectId: string; taskId: string; screenshotId: string; qaCaseId: string;
 revisionId: string; status: 'awaiting-verdict' | 'decided';
 differencePercent?: number; comparedAt?: string; createdAt: string;
};
export type Activity = {
 id: string; projectId: string; taskId?: string; action: string; actor: string; channel: string;
 at: string; from?: string; to?: string; reason?: string; evidence?: Record<string, unknown>;
};
export type ReviewerDecision = { verdict: 'approve' | 'reject'; reason?: string; fingerprint?: string; evidenceId?: string };
export type StorageTotals = { originals: number; thumbnails: number; bytes: number };
export type JobRecord = {
 id:string;projectId:string;operation:string;input:Record<string,unknown>;
 requestHash:string;idempotencyKey?:string;actor:Actor;
 status:'queued'|'running'|'succeeded'|'failed'|'interrupted'|'cancelled';
 progress:number;attempts:number;result?:unknown;
 error?:{code:string;message:string};createdAt:string;updatedAt:string;
 startedAt?:string;finishedAt?:string;
};
export type Snapshot = {
 project: Project; tasks: TaskRecord[]; previews: Preview[]; cases: QaCase[];
 bugs: BugThread[]; activity: Activity[]; screenshots: Screenshot[];
};
export type ApiProblem = { code: string; message: string; details?: Record<string, unknown> };
export class DomainError extends Error {
 constructor(public code: string, message: string, public httpStatus=400, public details?: Record<string, unknown>) {
  super(message); this.name='DomainError';
 }
}
export function requireText(value: unknown, name: string): string {
 if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_'+name.toUpperCase(), name+' must not be empty');
 return value.trim();
}
export function now() { return new Date().toISOString(); }
export function makeId(prefix: string) { return prefix+'_'+crypto.randomUUID(); }
export function isViewport(value: Viewport) {
 return value && Number.isInteger(value.width) && value.width >= 240 && value.width <= 3840 &&
  Number.isInteger(value.height) && value.height >= 240 && value.height <= 3840 &&
  ['desktop','tablet','mobile'].includes(value.device);
}
export function riskLabel(risk: Risk): string {
 return risk === 'HIGH' ? 'Risk review required: high-impact operation' : risk === 'MEDIUM' ? 'Review recommended: unknown or shared scope' : 'Local, reversible and verifiable';
}
