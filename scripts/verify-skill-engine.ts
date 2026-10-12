import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowlyApp } from '../packages/core/src/app.js';
import { routeSkills, type SkillRouterInput } from '../packages/core/src/skillRouter.js';
import { getAgentBootstrap } from '../packages/core/src/skillBootstrap.js';
import { getNextAction } from '../packages/core/src/skillNextAction.js';

export const coldStartRoutingCases: ReadonlyArray<{
  label: string; input: SkillRouterInput; expected: string;
}> = [
  { label: 'blank cold start', input: {}, expected: 'agent-bootstrap' },
  { label: 'English create card', input: {intent:'create card'}, expected:'card-authoring' },
  { label: 'Thai write card', input: {intent:'เขียนการ์ดให้ละเอียด'}, expected:'card-authoring' },
  { label: 'task authoring', input: {intent:'author a task'}, expected:'card-authoring' },
  { label: 'Jira authoring', input: {intent:'Create a task from Jira'}, expected:'card-authoring' },
  { label: 'pure source research', input: {intent:'Read Figma reference'}, expected:'source-evidence' },
  { label: 'evidence Thai', input: {intent:'อ้างอิงหลักฐานต้นทาง'}, expected:'source-evidence' },
  { label: 'decompose', input: {intent:'decompose feature'}, expected:'decomposition' },
  { label: 'split workstreams', input: {intent:'split tasks into workstreams'}, expected:'decomposition' },
  { label: 'Thai parallel', input: {intent:'แยกงานแบบขนาน'}, expected:'decomposition' },
  { label: 'English implement', input: {intent:'implement feature'}, expected:'implementation' },
  { label: 'bug fixing', input: {intent:'fix bug'}, expected:'implementation' },
  { label: 'Thai code fix', input: {intent:'แก้บั๊ก'}, expected:'implementation' },
  { label: 'refactor', input: {intent:'refactor code'}, expected:'implementation' },
  { label: 'Thai implementation', input: {intent:'ลงมือทำ'}, expected:'implementation' },
  { label: 'English loop', input: {intent:'loop the board'}, expected:'board-loop' },
  { label: 'Thai loop', input: {intent:'ทำต่อให้เสร็จ'}, expected:'board-loop' },
  { label: 'continue named task', input: {intent:'continue',taskStatus:'in-progress'}, expected:'board-loop' },
  { label: 'English review', input: {intent:'review changes'}, expected:'review' },
  { label: 'Thai review', input: {intent:'รีวิวการ์ด'}, expected:'review' },
  { label: 'explicit reject', input: {intent:'reject review'}, expected:'review' },
  { label: 'visual QA', input: {intent:'visual QA screenshot'}, expected:'ui-ux' },
  { label: 'responsive', input: {intent:'fix responsive layout'}, expected:'ui-ux' },
  { label: 'Thai screen', input: {intent:'ดูหน้าจอ'}, expected:'ui-ux' },
  { label: 'verification', input: {intent:'run verification'}, expected:'verification' },
  { label: 'regression', input: {intent:'test regression'}, expected:'verification' },
  { label: 'Thai tests', input: {intent:'ทดสอบ'}, expected:'verification' },
  { label: 'fallback backlog', input: {intent:'',taskStatus:'backlog'}, expected:'card-authoring' },
  { label: 'fallback working', input: {intent:'',taskStatus:'in-progress'}, expected:'implementation' },
  { label: 'fallback reviewer', input: {intent:'',taskStatus:'ready-for-review'}, expected:'review' },
  { label: 'unknown falls back', input: {intent:'blorpy blorp'}, expected:'skill-router' },
];

export type SkillEvalReport = {
  schemaVersion: 1;
  cases: number;
  correct: number;
  accuracy: number;
  targetAccuracy: number;
  routeP95Ms: number;
  discoveryCalls: number;
  coldStart: 'passed'|'failed';
  crossProject: 'passed'|'failed';
  gateBypassCount: number;
  failures: Array<{label:string; expected:string; actual:string}>;
};
const percentile=(values:number[],p:number)=>
  values.length===0?0:[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]!;
export async function runSkillEngineEvaluation(): Promise<SkillEvalReport> {
  const root=mkdtempSync(join(tmpdir(),'flowly-skill-eval-'));
  const app=new FlowlyApp(root);
  try {
    const manifests=app.skills.list();
    const times:number[]=[];
    const failures: SkillEvalReport['failures']=[];
    for(const item of coldStartRoutingCases) {
      const start=performance.now();
      const route=routeSkills(manifests,item.input);
      times.push(performance.now()-start);
      const actual=route.selected[0]?.skillId||'NO_MATCH';
      if(actual!==item.expected) failures.push({label:item.label,expected:item.expected,actual});
    }
    const actor={actor:'skill-eval',channel:'cli' as const};
    const one=app.tasks.createProject({name:'One'},actor);
    const two=app.tasks.createProject({name:'Two'},actor);
    const t=app.tasks.createTask({projectId:one.id,title:'High security',risk:{publicContract:true}},actor);
    const snapshot=JSON.stringify(app.tasks.activity(one.id));
    const ambiguous=getAgentBootstrap(app).projectSelection.state==='choose-project';
    const scoped=getAgentBootstrap(app,{projectId:one.id}).projectSelection.state==='selected';
    const next=getNextAction(app,{projectId:one.id,taskId:t.id});
    const safe=next.reason==='DECISION_REQUIRED' && next.readOnly &&
      app.tasks.task(t.id).status==='backlog' &&
      JSON.stringify(app.tasks.activity(one.id))===snapshot;
    let crossProjectDenied=false;
    try {getNextAction(app,{projectId:two.id,taskId:t.id});}
    catch(error){crossProjectDenied=(error as {code?:string}).code==='PROJECT_MISMATCH';}
    return {
      schemaVersion:1,cases:coldStartRoutingCases.length,
      correct:coldStartRoutingCases.length-failures.length,
      accuracy:Number(((coldStartRoutingCases.length-failures.length)/coldStartRoutingCases.length).toFixed(4)),
      targetAccuracy:0.95,routeP95Ms:Number(percentile(times,0.95).toFixed(3)),
      discoveryCalls:3,coldStart:ambiguous&&scoped&&safe?'passed':'failed',
      crossProject:crossProjectDenied?'passed':'failed',
      gateBypassCount:safe?0:1,failures,
    };
  }finally{
    await app.close();
    rmSync(root,{recursive:true,force:true});
  }
}
const currentFile=process.argv[1]?.replaceAll('\\','/');
if(currentFile && currentFile.endsWith('/verify-skill-engine.ts')){
 const r=await runSkillEngineEvaluation();
 console.log(JSON.stringify(r,null,2));
 if(r.accuracy<r.targetAccuracy||r.coldStart!=='passed'||r.crossProject!=='passed'||r.gateBypassCount!==0)
   process.exitCode=1;
}
