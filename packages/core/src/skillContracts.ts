import { createHash } from 'node:crypto';
import { DomainError } from './models.js';

export type SkillScope = 'global' | 'project';
export type SkillSource = 'builtin' | 'project' | 'imported';
export type SkillReason =
  | 'AUTHORING' | 'SOURCE_EVIDENCE' | 'DECOMPOSITION' | 'IMPLEMENTATION'
  | 'BOARD_LOOP' | 'REVIEW' | 'VISUAL_QA' | 'VERIFICATION'
  | 'BOOTSTRAP' | 'NO_MATCH' | 'AMBIGUOUS' | 'BLOCKED';
export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  scope: SkillScope;
  source: SkillSource;
  projectId?: string;
  triggers: string[];
  references: string[];
  enabled: boolean;
};
export type SkillSelection = { skillId: string; version: string; sha256: string; reason: SkillReason };
export type SkillRoute = {
  schemaVersion: 1;
  selected: SkillSelection[];
  reason: SkillReason;
  requiresChoice?: boolean;
};
export type SkillGuide = {
  schemaVersion: 1;
  selections: SkillSelection[];
  instructions: string;
  truncated: boolean;
  referencesAvailable: string[];
  maxChars: number;
};
export type AgentBootstrapChoice = { projectId: string; name: string; platform: string };
export type AgentBootstrapContract = {
  schemaVersion: 1;
  authority: 'advisory';
  readOnly: true;
  projectId?: string;
  projectChoices?: AgentBootstrapChoice[];
  reason: string;
  nextOperation: string;
};
export type NextActionContract = {
  schemaVersion: 1;
  readOnly: true;
  projectId?: string;
  taskId?: string;
  operation: string;
  reason: string;
  blockers: string[];
  prerequisites: string[];
};
export const MAX_GUIDE_CHARS = 12000;
const skillId = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;
const digest = /^[0-9a-f]{64}$/;
function invalid(code: string, message: string): never {
  throw new DomainError(code, message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('INVALID_SKILL_MANIFEST','Expected manifest object');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid('INVALID_SKILL_FIELD',field+' must be a bounded nonempty string');
  return value.trim();
}
export function skillHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
export function safeSkillReference(input: string): string {
  const value = nonempty(input,'reference',250);
  const normalized = value.replaceAll('\\','/');
  if (normalized !== value || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) ||
      normalized.includes('//') || normalized.includes('?') || normalized.includes('#') ||
      normalized.split('/').some(part => !part || part==='.' || part==='..') ||
      !normalized.startsWith('references/')) invalid('UNSAFE_SKILL_REFERENCE','Skill references must stay within references/');
  return normalized;
}
export function validateSkillManifest(input: unknown): SkillManifest {
  const raw = object(input);
  const id = nonempty(raw.id,'id',80);
  if (!skillId.test(id)) invalid('INVALID_SKILL_ID','Skill ID must be kebab-case');
  const release = nonempty(raw.version,'version',100);
  if (!version.test(release)) invalid('INVALID_SKILL_VERSION','Expected semantic version');
  const sha256 = nonempty(raw.sha256,'sha256',64);
  if (!digest.test(sha256)) invalid('INVALID_SKILL_HASH','Expected lowercase SHA-256 hex');
  const scope = raw.scope;
  if (scope !== 'global' && scope !== 'project') invalid('INVALID_SKILL_SCOPE','Scope must be global or project');
  const source = raw.source;
  if (!['builtin','project','imported'].includes(String(source))) invalid('INVALID_SKILL_SOURCE','Unsupported source');
  const projectId = raw.projectId;
  if (scope === 'project' && (typeof projectId !== 'string' || !/^proj_[\w-]{10,80}$/.test(projectId)))
    invalid('SKILL_PROJECT_REQUIRED','Project-scoped skills require a project ID');
  if (scope === 'global' && projectId !== undefined) invalid('INVALID_SKILL_PROJECT','Global skill cannot specify a project');
  if (typeof raw.enabled !== 'boolean') invalid('INVALID_SKILL_ENABLED','Enabled must be boolean');
  if (!Array.isArray(raw.triggers) || raw.triggers.length < 1 || raw.triggers.length > 24)
    invalid('INVALID_SKILL_TRIGGERS','Provide 1-24 triggers');
  const triggers = raw.triggers.map(x => nonempty(x,'trigger',180));
  if (new Set(triggers.map(t => t.toLowerCase())).size !== triggers.length)
    invalid('DUPLICATE_SKILL_TRIGGER','Duplicate trigger');
  if (!Array.isArray(raw.references) || raw.references.length > 32)
    invalid('INVALID_SKILL_REFERENCES','References must be a bounded list');
  const references = raw.references.map(x => safeSkillReference(x));
  if (new Set(references).size !== references.length) invalid('DUPLICATE_SKILL_REFERENCE','Duplicate reference');
  return {
    id, name: nonempty(raw.name,'name',140), description: nonempty(raw.description,'description',1200),
    version: release, sha256, scope, source: source as SkillSource,
    ...(scope === 'project' ? { projectId: projectId as string } : {}),
    triggers, references, enabled: raw.enabled,
  };
}
export function clampGuideBudget(value?: number): number {
  if (value === undefined) return MAX_GUIDE_CHARS;
  if (!Number.isInteger(value) || value < 256 || value > MAX_GUIDE_CHARS)
    invalid('INVALID_CONTEXT_BUDGET','Budget must be 256..'+MAX_GUIDE_CHARS);
  return value;
}
