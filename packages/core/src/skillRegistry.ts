import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalStore } from '../../db/src/store.js';
import type { Actor, Project } from './models.js';
import { DomainError } from './models.js';
import { skillHash, validateSkillManifest, safeSkillReference, type SkillManifest } from './skillContracts.js';

export type RegisteredSkill = { manifest: SkillManifest; content: string };
export type SkillQuery = { id: string; projectId?: string; version?: string };
export type SkillListQuery = { projectId?: string; includeDisabled?: boolean };
export type ProjectSkillInput = {
  projectId: string; content: string; version?: string; triggers?: string[];
};
const BUILTIN_ROOT = fileURLToPath(new URL('../../skills/', import.meta.url));
const INDEX_LIMIT = 500;
const CONTENT_LIMIT = 100_000;
function requiredProject(store: LocalStore, projectId: string): void {
  if (!store.get<Project>('project', projectId))
    throw new DomainError('NOT_FOUND', 'Project not found', 404);
}
function frontmatter(content: string): { name: string; description: string } {
  const m = content.match(/^---\r?\nname: ([a-z][a-z0-9-]*)\r?\ndescription: ([^\r\n]+)\r?\n---(?:\r?\n|$)/);
  if (!m) throw new DomainError('INVALID_SKILL_FRONTMATTER',
    'SKILL.md requires lowercase name and one-line description in YAML frontmatter');
  return { name: m[1]!, description: m[2]!.trim() };
}
function body(content: string): string {
  if (typeof content !== 'string' || content.length < 30 || content.length > CONTENT_LIMIT)
    throw new DomainError('INVALID_SKILL_CONTENT','Skill content must be 30..100000 characters');
  return content;
}
function immutable(record: RegisteredSkill): RegisteredSkill {
  return { manifest: {...record.manifest, triggers:[...record.manifest.triggers],
    references:[...record.manifest.references]}, content:record.content };
}
function indexKey(projectId: string): string { return 'skills:index:'+projectId; }
function skillKey(projectId: string,id: string,version: string): string {
  return 'skills:project:'+projectId+':'+id+':'+version;
}
export class SkillRegistry {
  private readonly builtins: RegisteredSkill[];
  constructor(private readonly store: LocalStore, private readonly root: string = BUILTIN_ROOT) {
    this.builtins = this.loadBundled();
  }
  private loadBundled(): RegisteredSkill[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes:true }).filter(d=>d.isDirectory())
      .sort((a,b)=>a.name.localeCompare(b.name)).map(directory=>{
        const exact=path.join(this.root,directory.name,'SKILL.md');
        if (!fs.existsSync(exact)) throw new DomainError('MISSING_SKILL_ENTRYPOINT','Missing '+directory.name+'/SKILL.md');
        const content=body(fs.readFileSync(exact,'utf8'));
        const yaml=frontmatter(content);
        if (yaml.name!==directory.name)
          throw new DomainError('SKILL_ID_MISMATCH','Directory must match manifest name');
        const manifest=validateSkillManifest({
          id:yaml.name,name:yaml.name,description:yaml.description,version:'1.0.0',
          sha256:skillHash(content),source:'builtin',scope:'global',enabled:true,
          triggers:[yaml.description.slice(0,180)],references:[],
        });
        return {manifest,content};
      });
  }
  private enabledBuiltin(id: string): boolean {
    return this.store.setting('skills:builtin:enabled:'+id)!=='false';
  }
  private storedIndex(projectId: string): Array<{id:string;version:string}> {
    const raw=this.store.setting(indexKey(projectId));
    if (!raw) return [];
    let parsed: unknown;
    try { parsed=JSON.parse(raw); }catch{ throw new DomainError('CORRUPT_SKILL_INDEX','Skill index corrupted');}
    if (!Array.isArray(parsed) || parsed.length>INDEX_LIMIT ||
        parsed.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.version!=='string'))
      throw new DomainError('CORRUPT_SKILL_INDEX','Skill index invalid');
    return parsed;
  }
  private stored(projectId:string,id:string,version:string): RegisteredSkill | undefined {
    const raw=this.store.setting(skillKey(projectId,id,version));
    if (!raw) return undefined;
    let parsed: RegisteredSkill;
    try { parsed=JSON.parse(raw) as RegisteredSkill; }
    catch { throw new DomainError('CORRUPT_SKILL_RECORD','Skill record corrupted'); }
    if (!parsed?.manifest || !parsed.content ||
        parsed.manifest.projectId!==projectId || parsed.manifest.id!==id || parsed.manifest.version!==version ||
        parsed.manifest.sha256!==skillHash(parsed.content))
      throw new DomainError('CORRUPT_SKILL_RECORD','Stored Skill revision failed validation');
    validateSkillManifest(parsed.manifest);
    return parsed;
  }
  list(query: SkillListQuery = {}): SkillManifest[] {
    if (query.projectId) requiredProject(this.store,query.projectId);
    const builtins=this.builtins.map(s=>({...s.manifest,enabled:this.enabledBuiltin(s.manifest.id)}));
    const locals=query.projectId
      ? this.storedIndex(query.projectId).map(x=>this.stored(query.projectId!,x.id,x.version)?.manifest)
        .filter((x):x is SkillManifest => Boolean(x)) : [];
    return [...builtins,...locals].filter(x=>query.includeDisabled||x.enabled)
      .sort((a,b)=>a.id.localeCompare(b.id)||a.version.localeCompare(b.version));
  }
  get(query: SkillQuery): RegisteredSkill {
    const builtin=this.builtins.find(x=>x.manifest.id===query.id);
    if (builtin) {
      if (query.version && query.version!==builtin.manifest.version)
        throw new DomainError('SKILL_VERSION_NOT_FOUND','Bundled Skill version not found',404);
      return immutable({ ...builtin,manifest:{...builtin.manifest,enabled:this.enabledBuiltin(builtin.manifest.id)} });
    }
    if (!query.projectId) throw new DomainError('SKILL_NOT_FOUND','Skill not found',404);
    requiredProject(this.store,query.projectId);
    const versions=this.storedIndex(query.projectId).filter(x=>x.id===query.id);
    const compareVersions=(left:string,right:string):number=>{
      const x=left.split(/[.-]/).slice(0,3).map(Number),y=right.split(/[.-]/).slice(0,3).map(Number);
      for(let i=0;i<3;i++){if((y[i]||0)!==(x[i]||0))return (y[i]||0)-(x[i]||0);}
      return right.localeCompare(left);
    };
    const selected=query.version
      ? versions.find(x=>x.version===query.version)
      : [...versions].sort((a,b)=>compareVersions(a.version,b.version)).find(x=>this.stored(query.projectId!,x.id,x.version)?.manifest.enabled);
    const stored=selected && this.stored(query.projectId,selected.id,selected.version);
    if (!stored) throw new DomainError(query.version||versions.length===0?'SKILL_NOT_FOUND':'SKILL_NOT_ENABLED','Requested active Skill revision not found',404);
    return immutable(stored);
  }
  importProject(input: ProjectSkillInput, actor: Actor): RegisteredSkill {
    requiredProject(this.store,input.projectId);
    const content=body(input.content),yaml=frontmatter(content);
    if (this.builtins.some(s=>s.manifest.id===yaml.name))
      throw new DomainError('BUILTIN_SKILL_PROTECTED','Project Skill cannot shadow built-in policy');
    const manifest=validateSkillManifest({
      id:yaml.name,name:yaml.name,description:yaml.description,version:input.version||'1.0.0',
      sha256:skillHash(content),source:'project',scope:'project',projectId:input.projectId,
      triggers:input.triggers?.length?input.triggers:[yaml.description.slice(0,180)],
      references:[],enabled:true,
    });
    return this.store.transactionImmediate(()=>{
      const key=skillKey(input.projectId,manifest.id,manifest.version);
      const existing=this.stored(input.projectId,manifest.id,manifest.version);
      if (existing) {
        if (existing.manifest.sha256!==manifest.sha256)
          throw new DomainError('SKILL_VERSION_CONFLICT','Existing immutable version has different content',409);
        return immutable(existing);
      }
      const list=this.storedIndex(input.projectId);
      if (list.length>=INDEX_LIMIT)throw new DomainError('SKILL_LIMIT','Too many project Skills');
      const registered={manifest,content};
      this.store.setSetting(key,JSON.stringify(registered));
      this.store.setSetting(indexKey(input.projectId),JSON.stringify([...list,{id:manifest.id,version:manifest.version}]));
      this.store.audit({projectId:input.projectId,action:'skill.import',actor:actor.actor,channel:actor.channel,
        evidence:{skillId:manifest.id,version:manifest.version,sha256:manifest.sha256}});
      return immutable(registered);
    });
  }
  setEnabled(query: SkillQuery & {enabled: boolean},actor: Actor): RegisteredSkill {
    const existing=this.get(query);
    if (typeof query.enabled!=='boolean')
      throw new DomainError('INVALID_SKILL_ENABLED','Enabled must be boolean');
    if (existing.manifest.source==='builtin') {
      if (query.projectId) requiredProject(this.store,query.projectId);
      const projectId=query.projectId || 'system';
      this.store.transactionImmediate(()=>{
        this.store.setSetting('skills:builtin:enabled:'+existing.manifest.id,String(query.enabled));
        this.store.audit({projectId,action:'skill.enable',actor:actor.actor,channel:actor.channel,
          evidence:{skillId:existing.manifest.id,enabled:query.enabled}});
      });
      return {...existing,manifest:{...existing.manifest,enabled:query.enabled}};
    }
    const projectId=existing.manifest.projectId!;
    const updated={...existing,manifest:{...existing.manifest,enabled:query.enabled}};
    this.store.transactionImmediate(()=>{
      this.store.setSetting(skillKey(projectId,existing.manifest.id,existing.manifest.version),JSON.stringify(updated));
      this.store.audit({projectId,action:'skill.enable',actor:actor.actor,channel:actor.channel,
        evidence:{skillId:existing.manifest.id,version:existing.manifest.version,enabled:query.enabled}});
    });
    return immutable(updated);
  }
  readReference(query: SkillQuery, ref: string): string {
    const found=this.get(query);
    const safe=safeSkillReference(ref);
    if (!found.manifest.references.includes(safe))
      throw new DomainError('SKILL_REFERENCE_NOT_DECLARED','Reference not listed in manifest');
    if (found.manifest.source!=='builtin')
      throw new DomainError('SKILL_REFERENCE_UNSUPPORTED','Imported Skill references are not executable/filesystem paths');
    const exact=path.resolve(this.root,found.manifest.id,safe);
    const parent=path.resolve(this.root,found.manifest.id);
    if (!exact.startsWith(parent+path.sep))
      throw new DomainError('UNSAFE_SKILL_REFERENCE','Reference path outside Skill');
    return fs.readFileSync(exact,'utf8');
  }
}
