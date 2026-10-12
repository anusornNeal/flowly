import type { FlowlyApp } from './app.js';
import type { TaskRecord, JobRecord } from './models.js';
import { DomainError } from './models.js';
import { engineeringBlockers, reportBlockers, decisionRequired, runnableStreams } from './engineering.js';

/** A recommendation is not a claim, task transition, QA decision or approval. */
export type NextActionInput = { projectId?: string; taskId?: string; sessionId?: string };
export type NextActionResult = {
  schemaVersion: 1;
  readOnly: true;
  projectId?: string;
  taskId?: string;
  operation: string;
  reason: string;
  params: Record<string, string>;
  blockers: string[];
  prerequisites: string[];
  candidates?: Array<{ id: string; displayId: string; status: TaskRecord['status'] }>;
  ownership: { status: 'UNSUPPORTED'; message: string };
};
const ownership: NextActionResult['ownership'] = {
  status: 'UNSUPPORTED',
  message: 'Durable claims/leases are not implemented. No ownership inferred from sessionId.',
};
const order: Record<TaskRecord['status'], number> = {
  'in-progress': 0, 'ready-for-review': 1, todo: 2, backlog: 3, done: 4,
};
const weight: Record<TaskRecord['priority'], number> = { high: 0, medium: 1, low: 2 };
function sortTasks(a: TaskRecord, b: TaskRecord): number {
  return order[a.status] - order[b.status] || weight[a.priority] - weight[b.priority] ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
function result(projectId: string | undefined, taskId: string | undefined, operation: string,
  reason: string, blockers: string[] = [], params: Record<string, string> = {},
  prerequisites: string[] = []): NextActionResult {
  return { schemaVersion: 1, readOnly: true, projectId, taskId, operation, reason, blockers, params, prerequisites, ownership };
}
function isActiveJob(job: JobRecord): boolean {
  return ['queued','running','interrupted'].includes(job.status);
}
function pendingJob(app: FlowlyApp, projectId: string, taskId?: string): JobRecord | undefined {
  const list = app.store.list<JobRecord>('job', { projectId }).filter(isActiveJob);
  const related = taskId ? list.filter(j => j.input?.taskId === taskId || j.input?.id === taskId) : list;
  const priority: Record<string, number> = { interrupted: 0, running: 1, queued: 2 };
  return related.sort((a,b) => (priority[a.status]??3)-(priority[b.status]??3) ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}
/** No writes, no side effects: exact project pinning and authoritative blockers only. */
export function getNextAction(app: FlowlyApp, input: NextActionInput = {}): NextActionResult {
  const projects = app.tasks.listProjects();
  if (input.projectId && !projects.some(p => p.id === input.projectId))
    throw new DomainError('NOT_FOUND', 'Selected project does not exist', 404);
  if (!input.projectId && projects.length === 0)
    return result(undefined, undefined, 'project.create', 'NO_PROJECTS');
  if (!input.projectId && projects.length > 1)
    return { ...result(undefined, undefined, 'project.list', 'PROJECT_SELECTION_REQUIRED'),
      prerequisites: projects.slice(0,20).map(p=>p.id) };
  const projectId = input.projectId || projects[0]!.id;
  let target: TaskRecord | undefined;
  if (input.taskId) {
    target = app.tasks.task(input.taskId);
    if (target.projectId !== projectId)
      throw new DomainError('PROJECT_MISMATCH', 'Task is not in the selected project', 409);
  } else {
    const pending = app.tasks.listTasks(projectId).filter(t => t.status !== 'done' && !t.parentId).sort(sortTasks);
    if (!pending.length) {
      const job = pendingJob(app,projectId);
      return job ? jobAction(projectId,undefined,job)
        : result(projectId,undefined,'task.list','NO_ELIGIBLE_TASK');
    }
    if (pending.length > 1)
      return { ...result(projectId,undefined,'task.list','TASK_SELECTION_REQUIRED'),
        candidates: pending.slice(0,10).map(t=>({id:t.id,displayId:t.displayId,status:t.status})) };
    target = pending[0]!;
  }
  const task = target;
  const taskId = task.id;
  const job = pendingJob(app,projectId,taskId);
  if (job) return jobAction(projectId,taskId,job);
  if (task.status === 'done')
    return result(projectId,taskId,'task.get','TASK_DONE',[],{id:taskId});
  const engineering = engineeringBlockers(task);
  if (engineering.includes('DECISION_APPROVAL_REQUIRED')) {
    const action = task.engineering?.decision ? 'engineering.decision.resolve' : 'engineering.decision.report';
    return result(projectId,taskId,action,'DECISION_REQUIRED',engineering,{id:taskId},
      ['Actual approval must be explicit; a recommendation cannot self-approve.']);
  }
  if (engineering.includes('PARALLEL_PLAN_REQUIRED'))
    return result(projectId,taskId,'engineering.parallel.plan','PARALLEL_PLAN_REQUIRED',engineering,{id:taskId});
  if (task.status === 'backlog')
    return result(projectId,taskId,'task.transition','MOVE_TO_TODO',[],{id:taskId,to:'todo'});
  if (task.status === 'todo')
    return result(projectId,taskId,'task.transition','READY_TO_START',[],{id:taskId,to:'in-progress'});
  const plan = task.engineering?.plan;
  if (task.status === 'in-progress' && plan) {
    const runnable = runnableStreams(plan);
    if (runnable.length) return result(projectId,taskId,'engineering.parallel.next','RUNNABLE_WORKSTREAMS',[],{id:taskId},
      runnable.map(s=>s.id));
    if (plan.workstreams.some(w=>w.status==='in-progress'))
      return result(projectId,taskId,'engineering.parallel.next','WORKSTREAM_IN_PROGRESS',[],{id:taskId});
    if (plan.workstreams.some(w=>w.status==='pending'))
      return result(projectId,taskId,'engineering.parallel.next','WAIT_FOR_DEPENDENCIES',[],{id:taskId});
  }
  const blockers = app.tasks.blockers(taskId);
  const openBug = blockers.includes('OPEN_BUGS');
  if (openBug) return result(projectId,taskId,'task.bugs','OPEN_BUGS',blockers,{id:taskId});
  if (blockers.includes('PREVIEW_APPROVAL_REQUIRED'))
    return result(projectId,taskId,'preview.list','PREVIEW_APPROVAL_REQUIRED',blockers,{projectId});
  if (blockers.includes('REQUIRED_QA_STALE') || blockers.includes('REQUIRED_QA_INCOMPLETE'))
    return result(projectId,taskId,'qa.list','QA_EVIDENCE_REQUIRED',blockers,{projectId,taskId},
      ['Current revision screenshot evidence and explicit verdict required.']);
  if (blockers.includes('CHECKLIST_INCOMPLETE'))
    return result(projectId,taskId,'task.checklist','CHECKLIST_INCOMPLETE',blockers,{id:taskId});
  if (blockers.includes('UNFINISHED_SUBTASKS'))
    return result(projectId,taskId,'task.context','UNFINISHED_SUBTASKS',blockers,{id:taskId});
  if (!task.testsPassed)
    return result(projectId,taskId,'task.tests','TEST_EVIDENCE_REQUIRED',blockers,{id:taskId},
      ['Run applicable repository tests and provide genuine verification evidence.']);
  if (decisionRequired(task) && reportBlockers(task).length)
    return result(projectId,taskId,'engineering.implementation.report','IMPLEMENTATION_REPORT_REQUIRED',
      reportBlockers(task),{id:taskId},['Use verified changes, tests and commit hashes.']);
  if (task.status === 'ready-for-review') {
    if (blockers.includes('REVIEW_NOT_APPROVED'))
      return result(projectId,taskId,'task.review','EXPLICIT_REVIEW_REQUIRED',blockers,{id:taskId});
    return result(projectId,taskId,'task.transition','READY_TO_DONE',blockers,{id:taskId,to:'done'});
  }
  if (task.reviewMode === 'require-review' || task.reviewMode === 'auto' && blockers.includes('REVIEW_NOT_APPROVED'))
    return result(projectId,taskId,'task.transition','READY_FOR_REVIEW',blockers,{id:taskId,to:'ready-for-review'});
  return result(projectId,taskId,'task.transition','READY_TO_DONE',blockers,{id:taskId,to:'done'});
}
function jobAction(projectId: string, taskId: string | undefined, job: JobRecord): NextActionResult {
  const retryable = job.status === 'interrupted';
  return result(projectId,taskId,retryable?'job.status':'job.status',
    retryable?'JOB_INTERRUPTED':'JOB_ACTIVE',[],{id:job.id},
    [retryable?'Inspect interrupted operation before explicit job.retry; never silently replay.':
      'Inspect same running or queued Job; do not start a duplicate.']);
}
