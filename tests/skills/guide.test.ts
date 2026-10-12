import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSkillGuide} from '../../packages/core/src/skillGuide.js';
import {skillHash,type SkillRoute,type SkillManifest} from '../../packages/core/src/skillContracts.js';
const content='---\nname: review\ndescription: Review cards\n---\n# Review\nNever claim PASS without evidence.';
const manifest:SkillManifest={id:'review',name:'review',description:'Review cards',version:'1.0.0',
 sha256:skillHash(content),scope:'global',source:'builtin',triggers:['review'],references:[],enabled:true};
const route:SkillRoute={schemaVersion:1,selected:[{skillId:manifest.id,version:manifest.version,
 sha256:manifest.sha256,reason:'REVIEW'}],reason:'REVIEW'};
const reader={get:()=>({manifest,content})};
test('loads whole specialist with pinned hash under a bounded budget',()=>{
 const x=buildSkillGuide(reader,route);
 assert.deepEqual(x.loadedSkillIds,['review']);assert.equal(x.truncated,false);
 assert.match(x.instructions,/Never claim PASS/);
 assert.equal(x.authority,'advisory');assert.ok(x.instructions.length<=x.maxChars);
});
test('insufficient budget omits entire Skill rather than truncate rule',()=>{
 const long='x'.repeat(500);
 const big={...manifest,sha256:skillHash(long)};
 const x=buildSkillGuide({get:()=>({manifest:big,content:long})},{
   schemaVersion:1,selected:[{skillId:'review',version:'1.0.0',sha256:big.sha256,reason:'REVIEW'}],reason:'REVIEW'
 },{maxChars:256});
 assert.equal(x.instructions,'');assert.equal(x.truncated,true);
 assert.deepEqual(x.omittedSkillIds,['review']);
});
test('hash mismatch and untrusted project scope cannot escalate',()=>{
 assert.throws(()=>buildSkillGuide(reader,{...route,selected:[{...route.selected[0]!,sha256:skillHash('tamper')}]}),{code:'SKILL_CONTENT_STALE'});
 const project={...manifest,scope:'project' as const,source:'project' as const,projectId:'proj_test'};
 assert.throws(()=>buildSkillGuide({get:()=>({manifest:project,content})},route,{projectId:'proj_test'}),{code:'UNTRUSTED_SKILL_CONTEXT'});
 assert.equal(buildSkillGuide({get:()=>({manifest:project,content})},route,{
   projectId:'proj_test',allowProjectGuidance:true}).loadedSkillIds.length,1);
});
test('invalid context budget, wrong ref and excessive selection rejected',()=>{
 assert.throws(()=>buildSkillGuide(reader,route,{maxChars:10}),{code:'INVALID_CONTEXT_BUDGET'});
 assert.throws(()=>buildSkillGuide(reader,route,{reference:'../config'}),{code:'UNSAFE_SKILL_REFERENCE'});
 assert.throws(()=>buildSkillGuide(reader,{...route,selected:[...route.selected,...route.selected,...route.selected,...route.selected]}),{code:'TOO_MANY_SKILLS'});
});
