export const LANES = ['backlog', 'todo', 'in-progress', 'ready-for-review', 'done'] as const;
export type Lane = typeof LANES[number];
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';
export type ReviewMode = 'auto' | 'require-review' | 'skip-review';
export type QaVerdict = 'PASS' | 'FAIL' | 'WAIVED';
export type Task = {
  id: string;
  status: Lane;
  reviewMode: ReviewMode;
  reviewSkipReason?: string;
  risk: {
    securityOrPermissions?: boolean;
    destructiveData?: boolean;
    schemaMigration?: boolean;
    publicContract?: boolean;
    sharedRuntimeConfig?: boolean;
    systemWide?: boolean;
    irreversible?: boolean;
    localScope?: boolean;
    reversible?: boolean;
    expectedOutcome?: boolean;
    acceptanceCriteria?: boolean;
    verificationStep?: boolean;
  };
  childIds: string[];
  requiredQa: Array<{ id: string; approvedRevision: string; currentApprovedRevision: string; verdict?: QaVerdict }>;
  testsPassed: boolean;
  reviewApproved: boolean;
};
export type AuditEvent = {
  taskId: string; actor: string; channel: 'cli' | 'web';
  action: string; timestamp: string; from: Lane; to: Lane;
  reason?: string; risk: Risk; evidence?: Readonly<Record<string, unknown>>;
};
export type TransitionRequest = { to: Lane; actor: string; channel: 'cli' | 'web'; reason?: string; forceDone?: boolean };
export type TransitionDecision = { ok: true; updated: Task; audit: AuditEvent } | { ok: false; blockers: string[] };
export function assessRisk(task: Pick<Task, 'risk'>): Risk {
  const r = task.risk;
  if (r.securityOrPermissions || r.destructiveData || r.schemaMigration || r.publicContract ||
      r.sharedRuntimeConfig || r.systemWide || r.irreversible) return 'HIGH';
  if (r.localScope && r.reversible && r.expectedOutcome && r.acceptanceCriteria && r.verificationStep) return 'LOW';
  return 'MEDIUM';
}
export function attemptTransition(task: Task, request: TransitionRequest, children: readonly Pick<Task, 'id' | 'status'>[], now: string): TransitionDecision {
  const blockers: string[] = [];
  const reason = request.reason?.trim();
  if (!request.actor.trim()) blockers.push('ACTOR_REQUIRED');
  if (task.status === 'done') blockers.push('DONE_IS_TERMINAL');
  const risk = assessRisk(task);
  const unfinished = children.filter(c => task.childIds.includes(c.id) && c.status !== 'done');
  if (request.to === 'done') {
    if (!task.testsPassed) blockers.push('TESTS_NOT_PASSED');
    if (task.requiredQa.some(c => c.verdict !== 'PASS' && c.verdict !== 'WAIVED' || c.approvedRevision !== c.currentApprovedRevision)) blockers.push('REQUIRED_QA_NOT_CURRENT');
    const reviewRequired = task.reviewMode === 'require-review' ||
      task.reviewMode === 'auto' && risk !== 'LOW';
    if (reviewRequired && !task.reviewApproved) blockers.push('REVIEW_NOT_APPROVED');
    if (task.reviewMode === 'skip-review' && risk !== 'LOW' && !task.reviewSkipReason?.trim()) blockers.push('REVIEW_SKIP_REASON_REQUIRED');
    if (unfinished.length && !request.forceDone) blockers.push('UNFINISHED_SUBTASKS');
    if (unfinished.length && request.forceDone && !reason) blockers.push('FORCE_DONE_REASON_REQUIRED');
  }
  if (blockers.length) return { ok: false, blockers };
  const updated = { ...task, status: request.to };
  return { ok: true, updated, audit: {
    taskId: task.id, actor: request.actor, channel: request.channel,
    action: request.forceDone && unfinished.length ? 'force-done' : 'transition',
    timestamp: now, from: task.status, to: request.to, reason, risk,
    evidence: unfinished.length && request.forceDone
      ? { unfinishedChildren: unfinished.map(c => ({ id: c.id, status: c.status })) }
      : undefined
  } };
}
