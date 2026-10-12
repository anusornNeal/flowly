import type { FlowlyApp } from './app.js';
import { DomainError } from './models.js';
import type { Lane } from './workflow.js';

export type SkillPreflightInput = {
  projectId: string;
  taskId: string;
  operation: 'task.transition' | 'task.review' | 'qa.verdict' | 'preview.approve' |
    'engineering.decision.resolve' | 'engineering.parallel.status';
  to?: Lane;
  reason?: string;
  forceDone?: boolean;
};
export type SkillPreflightResult = {
  schemaVersion: 1;
  readOnly: true;
  authoritative: false;
  operation: SkillPreflightInput['operation'];
  projectId: string;
  taskId: string;
  preflight: 'passed' | 'blocked' | 'explicit-action-required';
  reasonCode: string;
  blockers: string[];
  currentStatus: string;
  next: string;
};

function base(input: SkillPreflightInput, status: string): Pick<SkillPreflightResult,
 'schemaVersion' | 'readOnly' | 'authoritative' | 'operation' | 'projectId' | 'taskId' | 'currentStatus'> {
  return {
    schemaVersion:1,readOnly:true,authoritative:false,
    operation:input.operation,projectId:input.projectId,
    taskId:input.taskId,currentStatus:status,
  };
}
function domainReasons(error: DomainError): string[] {
  const details = error.details;
  const reasons = details && Array.isArray(details.blockers)
    ? details.blockers.filter((v): v is string => typeof v==='string') : [];
  return reasons.length ? reasons : [error.code];
}
/**
 * An advisory preflight with NO authority to grant an action.
 * For Task transitions the source-of-truth transition validator is executed
 * in Flowly's rollback-only SQLite transaction: no audit/Task mutation survives.
 * Other operations require a deliberate domain call and evidence.
 */
export function preflightSkillAction(app: FlowlyApp, input: SkillPreflightInput): SkillPreflightResult {
  const project=app.tasks.project(input.projectId);
  const task=app.tasks.task(input.taskId);
  if (project.id!==task.projectId)
    throw new DomainError('PROJECT_MISMATCH','Task is not in selected project',409);
  const common=base(input,task.status);
  if (input.operation === 'task.transition') {
    if (!input.to)
      throw new DomainError('TARGET_STATUS_REQUIRED','Transition target is required');
    try {
      app.store.dryRun(()=>app.tasks.transition(input.taskId,
        {to:input.to!,reason:input.reason,forceDone:input.forceDone},
        {actor:'skill-preflight',channel:'cli'}));
      return {...common,preflight:'passed',reasonCode:'VALIDATOR_PREFLIGHT_PASSED',
        blockers:[],next:'Invoke task.transition explicitly; revalidate at mutation time.'};
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return {...common,preflight:'blocked',reasonCode:error.code,
        blockers:domainReasons(error),next:'Inspect task.blockers and resolve current authoritative prerequisites.'};
    }
  }
  const reasons=app.tasks.blockers(input.taskId);
  return {
    ...common,
    preflight:'explicit-action-required',
    reasonCode:'DOMAIN_ACTION_REQUIRED',
    blockers:reasons,
    next: input.operation==='task.review'
      ? 'Review actual implementation and evidence; invoke task.review explicitly only in Ready for Review.'
      : input.operation==='qa.verdict'
        ? 'Inspect current approved QA Case and linked original screenshot; invoke qa.verdict deliberately.'
        : input.operation==='preview.approve'
          ? 'Run real rendered quality verification; approve exact Preview revision explicitly.'
          : input.operation==='engineering.decision.resolve'
            ? 'Read current versioned Decision Report and intentionally approve/reject selected approach.'
            : 'Verify current dependency wave and ownership; update a workstream with real evidence.',
  };
}
