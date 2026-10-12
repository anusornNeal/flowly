import test from 'node:test';
import assert from 'node:assert/strict';
import {routeSkills} from '../../packages/core/src/skillRouter.js';
import {skillHash,type SkillManifest} from '../../packages/core/src/skillContracts.js';
const ids=['skill-router','agent-bootstrap','card-authoring','source-evidence','decomposition',
 'implementation','board-loop','review','ui-ux','verification'];
const manifests: SkillManifest[]=ids.map(id=>({id,name:id,description:id,version:'1.0.0',
 sha256:skillHash(id),scope:'global',source:'builtin',triggers:[id],references:[],enabled:true}));
const names=(intent:string,taskStatus?:'backlog'|'todo'|'in-progress'|'ready-for-review'|'done')=>
 routeSkills(manifests,{intent,projectId:'proj_test',taskStatus}).selected.map(x=>x.skillId);
test('cold start and task state fallback select one specialist',()=>{
 assert.deepEqual(routeSkills(manifests,{}).selected.map(s=>s.skillId),['agent-bootstrap']);
 assert.deepEqual(names('', 'backlog'),['card-authoring']);
 assert.deepEqual(names('', 'in-progress'),['implementation']);
 assert.deepEqual(names('', 'ready-for-review'),['review']);
});
test('common Thai/English intents route with progressive specialists',()=>{
 assert.deepEqual(names('เขียนการ์ดละเอียดจาก Jira'),['card-authoring','source-evidence']);
 assert.deepEqual(names('Implement with parallel workstreams'),['implementation','decomposition']);
 assert.deepEqual(names('loop ทำต่อให้เสร็จ'),['board-loop','implementation']);
 assert.deepEqual(names('Review visual QA screenshot'),['review','ui-ux','verification']);
 assert.deepEqual(names('ทดสอบ regression'),['verification']);
 assert.deepEqual(names('refactor code'),['implementation']);
});
test('pinning and enabled/trust filter prevent self-elevated project skills',()=>{
 const untrusted:SkillManifest={...manifests.find(m=>m.id==='implementation')!,source:'project',scope:'project',projectId:'proj_a',sha256:skillHash('bad')};
 const others=[...manifests.filter(x=>x.id!=='implementation'),untrusted];
 assert.equal(routeSkills(others,{intent:'implement',projectId:'proj_b'}).selected[0]?.skillId,'skill-router');
 assert.equal(routeSkills(others,{intent:'implement',projectId:'proj_a'}).selected[0]?.skillId,'skill-router');
 assert.equal(routeSkills(others,{intent:'implement',projectId:'proj_a',allowProjectGuidance:true}).selected[0]?.sha256,untrusted.sha256);
 const disabled=manifests.map(m=>m.id==='review'?{...m,enabled:false}:m);
 assert.equal(routeSkills(disabled,{intent:'review'}).selected[0]?.skillId,'skill-router');
});
test('repeatable deterministic ordering and bounded selections',()=>{
 const args={intent:'review UI QA screenshot with parallel test and implementation',projectId:'proj_a'};
 const first=routeSkills(manifests,args);
 assert.deepEqual(routeSkills(manifests,args),first);
 assert.ok(first.selected.length<=3);
 assert.ok(first.selected.every(x=>x.sha256.length===64));
});

test('approved project guidance uses explicit opt-in and selected immutable active revision',()=>{
 const baseline=manifests.filter(m=>m.id==='review');
 const custom:SkillManifest={id:'custom-qa',name:'custom-qa',description:'Project custom quality checks',
  version:'1.1.0',sha256:skillHash('active'),scope:'project',source:'project',
  projectId:'proj_a',triggers:['custom quality'],references:[],enabled:true};
 const old:SkillManifest={...custom,version:'1.0.0',sha256:skillHash('retired'),enabled:false};
 const input={intent:'review custom quality',projectId:'proj_a'};
 const no=routeSkills([...baseline,old,custom],input);
 assert.ok(!no.selected.some(x=>x.skillId==='custom-qa'));
 const yes=routeSkills([...baseline,old,custom],{...input,allowProjectGuidance:true});
 assert.deepEqual(yes.selected.map(x=>x.skillId),['review','custom-qa']);
 assert.equal(yes.selected[1]?.version,'1.1.0');
 assert.equal(yes.selected[1]?.reason,'PROJECT_GUIDANCE');
 const foreign=routeSkills([...baseline,custom],{...input,projectId:'proj_b',allowProjectGuidance:true});
 assert.ok(!foreign.selected.some(x=>x.skillId==='custom-qa'));
});
