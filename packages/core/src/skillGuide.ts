import { DomainError } from './models.js';
import { clampGuideBudget, skillHash, safeSkillReference,
  type SkillManifest, type SkillRoute, type SkillGuide } from './skillContracts.js';

export type SkillReader = {
  get(query: {id:string;projectId?:string;version?:string}): {manifest:SkillManifest;content:string};
  readReference?(query:{id:string;projectId?:string;version?:string},ref:string):string;
};
export type GuideInput = {
  projectId?: string; maxChars?: number; allowProjectGuidance?: boolean; reference?: string;
};
export type BoundedGuide = SkillGuide & {
  authority: 'advisory'; loadedSkillIds: string[]; omittedSkillIds: string[];
};
/**
 * Progressive loading: select only version-pinned full skill entries and never
 * truncate a SKILL.md in the middle of safety or workflow instructions.
 */
export function buildSkillGuide(reader: SkillReader, route: SkillRoute, input: GuideInput = {}): BoundedGuide {
  const limit=clampGuideBudget(input.maxChars);
  if (route.selected.length>3)
    throw new DomainError('TOO_MANY_SKILLS','Guide loads at most three routed Skills');
  const content: string[]=[];
  const loadedSkillIds: string[]=[];
  const omittedSkillIds: string[]=[];
  const referencesAvailable: string[]=[];
  let used=0;
  for(const selected of route.selected){
    const found=reader.get({id:selected.skillId,version:selected.version,projectId:input.projectId});
    const m=found.manifest;
    if (!m.enabled || m.sha256!==selected.sha256 || m.version!==selected.version ||
        skillHash(found.content)!==m.sha256)
      throw new DomainError('SKILL_CONTENT_STALE','Selected Skill version or hash is no longer current',409);
    if (m.source!=='builtin' &&
        (!input.allowProjectGuidance || !input.projectId || m.projectId!==input.projectId))
      throw new DomainError('UNTRUSTED_SKILL_CONTEXT','Project guidance requires an explicit matching project',403);
    for(const ref of m.references) referencesAvailable.push(m.id+':'+ref);
    const prefix=content.length?'\n\n---\n\n':'';
    const section=prefix+'## '+m.id+' @ '+m.version+'\n\n'+found.content.trim();
    if (used+section.length>limit){
      omittedSkillIds.push(m.id);
      continue;
    }
    used+=section.length;
    content.push(section);
    loadedSkillIds.push(m.id);
  }
  if(input.reference!==undefined){
    if(route.selected.length!==1) throw new DomainError('REFERENCE_SKILL_REQUIRED','Choose exactly one Skill before reading a reference');
    const ref=safeSkillReference(input.reference);
    const chosen=route.selected[0]!;
    const file=reader.readReference?.({id:chosen.skillId,projectId:input.projectId,version:chosen.version},ref);
    if(file===undefined) throw new DomainError('REFERENCE_UNAVAILABLE','Skill registry cannot read requested reference');
    const section='\n\n### Reference: '+ref+'\n\n'+file.trim();
    if(used+section.length>limit)
      throw new DomainError('REFERENCE_EXCEEDS_BUDGET','Reference exceeds available context budget');
    content.push(section);used+=section.length;
  }
  return {
    schemaVersion:1,selections:route.selected,instructions:content.join(''),truncated:omittedSkillIds.length>0,
    referencesAvailable,maxChars:limit,authority:'advisory',loadedSkillIds,omittedSkillIds,
  };
}
