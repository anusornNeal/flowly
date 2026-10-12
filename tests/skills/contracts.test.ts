import test from 'node:test';
import assert from 'node:assert/strict';
import { skillHash, safeSkillReference, validateSkillManifest, clampGuideBudget } from '../../packages/core/src/skillContracts.js';
const base = {
 id:'card-authoring',name:'Card Authoring',description:'Author implementation-ready cards using the task CLI',
 version:'1.0.0',sha256:skillHash('test'),source:'builtin',scope:'global',triggers:['create card'],references:['references/quality.md'],enabled:true,
};
test('SHA256 deterministic and manifest roundtrip',()=>{
 assert.equal(skillHash('test').length,64);
 assert.deepEqual(validateSkillManifest(base),base);
 assert.deepEqual(validateSkillManifest({...base,scope:'project',projectId:'proj_00000000-0000-0000-0000-000000000001'}).projectId,'proj_00000000-0000-0000-0000-000000000001');
});
test('unsafe paths denied',()=>{
 for(const ref of ['../secret','references/../../secret','C:/windows','/etc/passwd','references\\a.md','references//x.md','references/./x.md'])
   assert.throws(()=>safeSkillReference(ref),{code:'UNSAFE_SKILL_REFERENCE'});
 assert.equal(safeSkillReference('references/gates.md'),'references/gates.md');
});
test('bad ids, versions, hashes and scope denied',()=>{
 assert.throws(()=>validateSkillManifest({...base,id:'Bad Name'}),{code:'INVALID_SKILL_ID'});
 assert.throws(()=>validateSkillManifest({...base,version:'latest'}),{code:'INVALID_SKILL_VERSION'});
 assert.throws(()=>validateSkillManifest({...base,sha256:'abc'}),{code:'INVALID_SKILL_HASH'});
 assert.throws(()=>validateSkillManifest({...base,scope:'project'}),{code:'SKILL_PROJECT_REQUIRED'});
 assert.throws(()=>validateSkillManifest({...base,projectId:'proj_other'}),{code:'INVALID_SKILL_PROJECT'});
});
test('duplicate or oversized triggers/references rejected',()=>{
 assert.throws(()=>validateSkillManifest({...base,triggers:['run','RUN']}),{code:'DUPLICATE_SKILL_TRIGGER'});
 assert.throws(()=>validateSkillManifest({...base,references:['references/x','references/x']}),{code:'DUPLICATE_SKILL_REFERENCE'});
 assert.throws(()=>validateSkillManifest({...base,references:['references/../admin']}),{code:'UNSAFE_SKILL_REFERENCE'});
});
test('bounded context budget',()=>{
 assert.equal(clampGuideBudget(),12000);
 assert.equal(clampGuideBudget(256),256);
 assert.throws(()=>clampGuideBudget(1),{code:'INVALID_CONTEXT_BUDGET'});
 assert.throws(()=>clampGuideBudget(12001),{code:'INVALID_CONTEXT_BUDGET'});
});
