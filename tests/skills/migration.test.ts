import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../../packages/skills/',import.meta.url);
const names=['skill-router','agent-bootstrap','card-authoring','source-evidence','decomposition','implementation','board-loop','review','ui-ux','verification'];
test('curated skill catalog contains exact independent entrypoints',()=>{
 const dirs=readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
 assert.deepEqual(dirs,names.slice().sort());
});
test('every SKILL.md has stable YAML name, description and meaningful instructions',()=>{
 for(const name of names){
  const body=readFileSync(new URL('../../packages/skills/'+name+'/SKILL.md',import.meta.url),'utf8');
  const match=body.match(/^---\r?\nname: ([a-z][a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/);
  assert.ok(match,'missing frontmatter for '+name);
  assert.equal(match?.[1],name);assert.ok((match?.[2]?.length||0)>50);
  assert.ok(body.length>360,'insufficient actionable guidance for '+name);
  assert.doesNotMatch(body,/\b(get_skill_router|claim_next_task|get_repo_context_bundle|finalize_task_workspace|get_tool_schema)\b/,
    'Devflow-only operations must not be ported as Flowly instructions');
 }
});
test('router references every specialist and safety contracts are explicit',()=>{
 const read=(name:string)=>readFileSync(new URL('../../packages/skills/'+name+'/SKILL.md',import.meta.url),'utf8');
 const router=read('skill-router');
 for(const name of ['agent-bootstrap','card-authoring','decomposition','implementation','board-loop','review','ui-ux','verification'])
  assert.ok(router.includes(name),'missing route '+name);
 assert.match(read('implementation'),/engineering\.decision\.report/);
 assert.match(read('review'),/task\.review/);
 assert.match(read('ui-ux'),/qa\.verdict/);
 assert.match(read('agent-bootstrap'),/(without|no) prior conversation|no prior account|zero historical context|zero history|no prior chat/i);
});
