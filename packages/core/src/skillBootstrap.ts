import type { FlowlyApp } from './app.js';
import { capabilities } from './app.js';
import type { TaskRecord } from './models.js';
import { DomainError } from './models.js';

/**
 * Zero-context discovery is deliberately advisory. It neither claims tasks nor
 * changes the persisted workflow. Actions must use Flowly's existing validators.
 */
export interface BootstrapRequest {
  projectId?: string;
  sessionId?: string;
}
export type BootstrapHint = {
  operation: string;
  reason: string;
  params: Record<string, string>;
};
export type BootstrapProjectChoice = {
  id: string;
  name: string;
  platform: 'web' | 'desktop' | 'mobile';
};
export type BootstrapProjectSelection =
  | { state: 'none'; total: 0 }
  | { state: 'choose-project'; total: number; choices: BootstrapProjectChoice[]; hasMore: boolean }
  | { state: 'selected'; project: BootstrapProjectChoice };

export interface BootstrapResult {
  schemaVersion: 1;
  mode: 'local-first';
  readOnly: true;
  authority: 'advisory';
  projectSelection: BootstrapProjectSelection;
  next: BootstrapHint;
  summary?: {
    taskCount: number;
    counts: Record<TaskRecord['status'], number>;
    candidates: Array<{ id: string; displayId: string; title: string; status: TaskRecord['status'] }>;
    hasMore: boolean;
  };
  cli: {
    discovery: string[];
    operations: string[];
    approvalAuthority: string[];
  };
}
const MAX_CHOICES = 20;
const MAX_CANDIDATES = 10;
function choice(p: BootstrapProjectChoice): BootstrapProjectChoice {
  return { id: p.id, name: p.name, platform: p.platform };
}
function cmpName(a: BootstrapProjectChoice, b: BootstrapProjectChoice): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
const statusOrder: Record<TaskRecord['status'], number> = {
  'in-progress': 0, 'ready-for-review': 1, todo: 2, backlog: 3, done: 4,
};
function cmpTask(a: TaskRecord, b: TaskRecord): number {
  const priority: Record<TaskRecord['priority'], number> = { high: 0, medium: 1, low: 2 };
  return statusOrder[a.status] - statusOrder[b.status]
    || priority[a.priority] - priority[b.priority]
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

/**
 * Read-only agent entrypoint. Explicit project IDs are authoritative;
 * when projects are ambiguous the caller must choose one.
 */
export function getAgentBootstrap(app: FlowlyApp, input: BootstrapRequest = {}): BootstrapResult {
  const all = app.tasks.listProjects().map(choice).sort(cmpName);
  const info = capabilities();
  const common = {
    schemaVersion: 1 as const,
    mode: 'local-first' as const,
    readOnly: true as const,
    authority: 'advisory' as const,
    cli: {
      discovery: ['bootstrap', 'next', 'guide', 'capabilities', 'project.list', 'task.context'],
      operations: [...info.operations],
      approvalAuthority: [...info.approvalAuthority],
    },
  };
  if (input.projectId !== undefined && (!input.projectId.trim() || input.projectId !== input.projectId.trim())) {
    throw new DomainError('INVALID_PROJECT_ID', 'projectId must be a non-empty exact identifier');
  }
  const selected = input.projectId
    ? all.find(project => project.id === input.projectId)
    : all.length === 1 ? all[0] : undefined;
  if (input.projectId && !selected) {
    throw new DomainError('NOT_FOUND', 'Project not found', 404);
  }
  if (!selected && all.length === 0) {
    return {
      ...common,
      projectSelection: { state: 'none', total: 0 },
      next: { operation: 'project.create', reason: 'NO_PROJECTS', params: {} },
    };
  }
  if (!selected) {
    return {
      ...common,
      projectSelection: {
        state: 'choose-project',
        total: all.length,
        choices: all.slice(0, MAX_CHOICES),
        hasMore: all.length > MAX_CHOICES,
      },
      next: { operation: 'project.list', reason: 'PROJECT_SELECTION_REQUIRED', params: {} },
    };
  }
  const allTasks = app.tasks.listTasks(selected.id).sort(cmpTask);
  const unfinished = allTasks.filter(task => task.status !== 'done' && !task.parentId);
  const counts: Record<TaskRecord['status'], number> = {
    backlog: 0, todo: 0, 'in-progress': 0, 'ready-for-review': 0, done: 0,
  };
  for (const task of allTasks) counts[task.status] += 1;
  const candidates = unfinished.slice(0, MAX_CANDIDATES).map(t => ({
    id: t.id, displayId: t.displayId, title: t.title, status: t.status,
  }));
  const next: BootstrapHint = unfinished.length === 0
    ? { operation: 'task.list', reason: 'NO_UNFINISHED_TASKS', params: { projectId: selected.id } }
    : unfinished.length === 1
      ? { operation: 'task.context', reason: 'SINGLE_ELIGIBLE_TASK', params: { id: unfinished[0]!.id } }
      : { operation: 'task.list', reason: 'TASK_SELECTION_REQUIRED', params: { projectId: selected.id } };
  return {
    ...common,
    projectSelection: { state: 'selected', project: selected },
    summary: {
      taskCount: allTasks.length,
      counts,
      candidates,
      hasMore: unfinished.length > MAX_CANDIDATES,
    },
    next,
  };
}
