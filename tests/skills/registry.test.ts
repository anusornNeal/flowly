import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowlyApp} from '../../packages/core/src/app.js';
import {SkillRegistry} from '../../packages/core/src/skillRegistry.js';
const actor={actor:'skills-test',channel:'cli' as const};
async function fixture(run:(app:FlowlyApp,registry:SkillRegistry)=>void|Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'flowly-registry-')),app=new FlowlyApp(root);
 try{await run(app,new SkillRegistry(app.store));}finally{await app.close();rmSync(root,{recursive:true,force:true});}
}
const content=(text='Follow project QA acceptance before completion.')=>
 '---\nname: custom-checklist\ndescription: Custom project checklist instructions used when reviewing active cards.\n---\n\n# Project Checklist\n'+text+'\n';

test('curated builtin catalog is read-only and version pinned',()=>fixture((app,registry)=>{
 const xs=registry.list();
 assert.equal(xs.length,10);
 const known=registry.get({id:'skill-router'});
 assert.equal(known.manifest.id,'skill-router');
 assert.equal(known.manifest.source,'builtin');
 assert.equal(known.manifest.sha256.length,64);
 assert.equal(registry.get({id:'skill-router',version:'1.0.0'}).content,known.content);
 assert.throws(()=>registry.get({id:'skill-router',version:'9.0.0'}),{code:'SKILL_VERSION_NOT_FOUND'});
 assert.throws(()=>registry.importProject({projectId:'proj_unknown',content:content()},actor),{code:'NOT_FOUND'});
}));
test('scoped immutable imports reject shadowing, updates and cross-project lookup',()=>fixture((app,registry)=>{
 const a=app.tasks.createProject({name:'A'},actor),b=app.tasks.createProject({name:'B'},actor);
 const x=registry.importProject({projectId:a.id,content:content()},actor);
 assert.equal(x.manifest.scope,'project');
 assert.equal(registry.importProject({projectId:a.id,content:content()},actor).manifest.sha256,x.manifest.sha256);
 assert.equal(registry.get({projectId:a.id,id:'custom-checklist'}).content,content());
 assert.throws(()=>registry.get({projectId:b.id,id:'custom-checklist'}),{code:'SKILL_NOT_FOUND'});
 assert.throws(()=>registry.importProject({projectId:a.id,content:content('Different payload')},actor),{code:'SKILL_VERSION_CONFLICT'});
 assert.throws(()=>registry.importProject({projectId:a.id,content:content().replace('custom-checklist','skill-router')},actor),{code:'BUILTIN_SKILL_PROTECTED'});
 registry.importProject({projectId:a.id,content:content('Revision with explicit rules'),version:'1.1.0'},actor);
 assert.equal(registry.list({projectId:a.id}).filter(s=>s.id==='custom-checklist').length,2);
 assert.equal(app.tasks.activity(a.id).filter(e=>e.action==='skill.import').length,2);
}));
test('enable/disable is audited, only project skill version is affected',()=>fixture((app,registry)=>{
 const a=app.tasks.createProject({name:'A'},actor),b=app.tasks.createProject({name:'B'},actor);
 registry.importProject({projectId:a.id,content:content()},actor);
 registry.setEnabled({projectId:a.id,id:'custom-checklist',version:'1.0.0',enabled:false},actor);
 assert.equal(registry.list({projectId:a.id}).some(x=>x.id==='custom-checklist'),false);
 assert.equal(registry.list({projectId:a.id,includeDisabled:true}).find(x=>x.id==='custom-checklist')?.enabled,false);
 assert.equal(registry.list({projectId:b.id}).some(x=>x.id==='custom-checklist'),false);
 registry.setEnabled({id:'skill-router',enabled:false},actor);
 assert.equal(registry.list().some(x=>x.id==='skill-router'),false);
 assert.equal(registry.list({includeDisabled:true}).find(x=>x.id==='skill-router')?.enabled,false);
 assert.equal(registry.get({id:'skill-router'}).manifest.enabled,false);
 assert.ok(app.tasks.activity(a.id).some(e=>e.action==='skill.enable'));
}));
test('traversal and version mismatches fail deterministically',()=>fixture((app,registry)=>{
 assert.throws(()=>registry.readReference({id:'skill-router'},'../admin'),{code:'UNSAFE_SKILL_REFERENCE'});
 assert.throws(()=>registry.readReference({id:'skill-router'},'references/not-listed.md'),{code:'SKILL_REFERENCE_NOT_DECLARED'});
 const p=app.tasks.createProject({name:'C'},actor);
 assert.throws(()=>registry.importProject({projectId:p.id,version:'latest',content:content()},actor),{code:'INVALID_SKILL_VERSION'});
 assert.throws(()=>registry.importProject({projectId:p.id,content:'bad'},actor),{code:'INVALID_SKILL_CONTENT'});
}));
