import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=(name:string)=>readFileSync(fileURLToPath(new URL('../../apps/web/src/'+name,import.meta.url)),'utf8');
test('Skill UI reachable through monitoring-first navigation and project pin',()=>{
 const app=source('App.tsx');
 assert.match(app,/type Page=.*?'skills'/);
 assert.match(app,/SkillAdmin projectId=\{projectId\}/);
 assert.match(app,/skills:'Skill Engine'/);
 assert.match(app,/\['skills',WandSparkles\]/);
});
test('admin controls wire actual API actions and stable signed versions',()=>{
 const component=source('SkillAdmin.tsx');
 for(const operation of ['skills.list','skills.get','skills.enable','skills.route','skills.audit.list',
  'skills.learning.list','skills.learning.propose','skills.learning.decide','skills.learning.rollback'])
  assert.ok(component.includes("'"+operation+"'"),operation);
 assert.match(component,/candidateSha256\.slice\(0,12\)/);
 assert.match(component,/window\.confirm/);
 assert.match(component,/Backend gates remain authoritative/);
});
test('local viewport styling supports bounded panel scrolling without horizontal overflow',()=>{
 const css=source('skillAdmin.css');
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/overflow-y:auto/);
 assert.match(css,/min-width:0/);
});
