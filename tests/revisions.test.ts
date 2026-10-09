import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FlowlyApp } from '../packages/core/src/app.js';
import { DomainError, type Comparison, type BugThread } from '../packages/core/src/models.js';

const agent={actor:'revision-agent',channel:'cli' as const};
const reviewer={actor:'qa-reviewer',channel:'web' as const};
const image=async()=>sharp({create:{width:390,height:740,channels:3,background:'#edf3fb'}}).png().toBuffer();
async function withFlowly(fn:(app:FlowlyApp)=>Promise<void>){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-revision-'));
 const app=new FlowlyApp(root);
 try{await fn(app);}finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
}
const home={id:'home',name:'Home',stateId:'default',viewport:{width:390,height:740,device:'mobile' as const}};
const empty={id:'home',name:'Home empty',stateId:'empty',viewport:{width:390,height:740,device:'mobile' as const}};

test('approval retains logical QA Case ID/classification and archives/restores an exact tuple without carrying verdict',async()=>{
 await withFlowly(async app=>{
  const p=app.tasks.createProject({name:'Revision QA'},agent);
  const t=app.tasks.createTask({projectId:p.id,title:'Home UI'},agent);
  const preview=app.previews.create({projectId:p.id,taskId:t.id,name:'Home flow',html:'<button>Go</button>',screens:[home,empty]},agent);
  const rev1=app.previews.saveRevision(preview.id,agent);
  const first=await app.previews.approve(preview.id,rev1.id,agent);
  assert.equal(first.cases.length,2);
  const a=first.cases.find(c=>c.stateId==='default')!,b=first.cases.find(c=>c.stateId==='empty')!;
  app.previews.setRequired(a.id,false,agent);
  app.previews.verdict(b.id,'WAIVED','Known empty-state issue',reviewer);
  const screenshot=await app.images.ingest({source:'manual',taskId:t.id,screenId:'home',stateId:'default',data:await image()},agent);
  app.previews.verdict(a.id,'PASS','Accepted',reviewer);
  const same=await app.previews.approve(preview.id,rev1.id,agent);
  assert.equal(same.cases.length,2);
  assert.equal(same.cases.find(c=>c.stateId==='default')?.id,a.id);
  const oldData=app.previews.getRevision(rev1.id);
  app.previews.updateDraft(preview.id,{html:'<button>New</button>',screens:[home]},agent);
  const rev2=app.previews.saveRevision(preview.id,agent);
  const second=await app.previews.approve(preview.id,rev2.id,agent);
  assert.equal(second.cases.length,1);
  assert.equal(second.cases[0]?.id,a.id);
  assert.equal(second.cases[0]?.required,false);
  assert.equal(second.cases[0]?.verdict,undefined);
  assert.equal(second.cases[0]?.evidenceId,undefined);
  const archived=app.previews.case(b.id);
  assert.equal(archived.archived,true);
  assert.equal(app.previews.cases({previewId:preview.id}).length,1);
  assert.equal(app.previews.cases({previewId:preview.id,allRevisions:true}).length,2);
  assert.equal(archived.history?.some(h=>h.verdict==='WAIVED'),true);
  assert.equal(app.previews.case(a.id).history?.some(h=>h.verdict==='PASS'&&h.evidenceId===screenshot.screenshot.id),true);
  // The historical screenshot still uses its original frozen revision, not the active revision.
  const historical=await app.compare(screenshot.screenshot.id);
  assert.equal(typeof historical.differencePercent,'number');
  assert.equal(app.images.cleanup([screenshot.screenshot.id],reviewer).skipped,1);
  assert.equal(oldData.html,'<button>Go</button>');
  app.previews.updateDraft(preview.id,{screens:[home,empty]},agent);
  const rev3=app.previews.saveRevision(preview.id,agent);
  const third=await app.previews.approve(preview.id,rev3.id,agent);
  assert.equal(third.cases.length,2);
  const restored=third.cases.find(c=>c.stateId==='empty')!;
  assert.equal(restored.id,b.id);
  assert.equal(restored.required,true);
  assert.equal(restored.archived,false);
  assert.equal(restored.verdict,undefined);
  assert.equal(restored.history?.some(h=>h.verdict==='WAIVED'),true);
  assert.equal(app.tasks.blockers(t.id).includes('REQUIRED_QA_INCOMPLETE'),true);
  assert.equal(app.previews.getRevision(rev1.id).html,'<button>Go</button>');
 });
});

test('WAIVED survives new evidence with pending comparison, Cancel WAIVED restores gate, explicit result replaces it',async()=>{
 await withFlowly(async app=>{
  const p=app.tasks.createProject({name:'Waiver policy'},agent);
  const t=app.tasks.createTask({projectId:p.id,title:'Checkout UI',risk:{
   localScope:true,reversible:true,acceptanceCriteria:true,verificationStep:true,expectedOutcome:true
  }},agent);
  const preview=app.previews.create({projectId:p.id,taskId:t.id,name:'Checkout',html:'<button>Checkout</button>',screens:[home]},agent);
  const rev=app.previews.saveRevision(preview.id,agent);
  const qa=(await app.previews.approve(preview.id,rev.id,agent)).cases[0]!;
  app.tasks.setTests(t.id,true,'Verified suite',agent);
  app.previews.verdict(qa.id,'WAIVED','Known intentional difference',reviewer);
  assert.equal(app.tasks.blockers(t.id).includes('REQUIRED_QA_INCOMPLETE'),false);
  const actual=await image();
  const first=await app.images.ingest({source:'external',sourceId:'agent-mobile',captureId:'one',projectId:p.id,taskId:t.id,screenId:'home',caseId:qa.id,data:actual},agent);
  assert.ok(first.comparison);
  assert.equal(first.comparison.status,'awaiting-verdict');
  assert.equal(app.previews.case(qa.id).verdict,'WAIVED');
  assert.equal(app.tasks.blockers(t.id).includes('REQUIRED_QA_INCOMPLETE'),false);
  const second=await app.images.ingest({source:'external',sourceId:'agent-mobile',captureId:'two',projectId:p.id,taskId:t.id,screenId:'home',caseId:qa.id,data:actual},agent);
  assert.notEqual(first.screenshot.id,second.screenshot.id);
  assert.equal(app.previews.case(qa.id).verdict,'WAIVED');
  assert.equal(app.previews.case(qa.id).comparisonId,second.comparison?.id);
  assert.equal(app.store.get<Comparison>('comparison',second.comparison!.id)?.status,'awaiting-verdict');
  app.previews.cancelWaiver(qa.id,agent,'Operator chose to recheck');
  assert.equal(app.previews.case(qa.id).verdict,undefined);
  assert.equal(app.tasks.blockers(t.id).includes('REQUIRED_QA_INCOMPLETE'),true);
  assert.throws(()=>app.previews.cancelWaiver(qa.id,agent),(e:unknown)=>e instanceof DomainError&&e.code==='NOT_WAIVED');
  const pass=app.previews.verdict(qa.id,'PASS','Compared and accepted',agent);
  assert.equal(pass.case.verdict,'PASS');
  const again=app.previews.verdict(qa.id,'PASS','Compared and accepted',agent);
  assert.equal(again.duplicate,true);
  assert.equal(app.tasks.blockers(t.id).includes('REQUIRED_QA_INCOMPLETE'),false);
  const audits=app.tasks.activity(p.id,t.id);
  assert.ok(audits.some(e=>e.action==='qa.waiver.cancel'&&e.evidence?.previousVerdict==='WAIVED'));
  assert.ok(audits.some(e=>e.action==='qa.verdict'&&e.evidence?.comparisonId===second.comparison!.id));
  const previously=app.previews.case(qa.id).history||[];
  assert.ok(previously.some(h=>h.verdict==='WAIVED'&&h.event==='waiver-cancelled'));
  assert.ok(previously.some(h=>h.event==='screenshot-arrived'&&h.verdict==='WAIVED'));
  assert.equal((await app.compare(first.screenshot.id)).dimensionsDiffer,false);
 });
});

test('repeated same confirmed FAIL cannot duplicate linked Bug after Done or embedded Bug before Done',async()=>{
 await withFlowly(async app=>{
  const p=app.tasks.createProject({name:'Fail dedup'},agent);
  const t=app.tasks.createTask({projectId:p.id,title:'Before Done'},agent);
  const preview=app.previews.create({projectId:p.id,taskId:t.id,name:'UI',html:'<button>Go</button>',screens:[home]},agent);
  const rev=app.previews.saveRevision(preview.id,agent);
  const c=(await app.previews.approve(preview.id,rev.id,agent)).cases[0]!;
  await app.images.ingest({source:'manual',taskId:t.id,screenId:'home',data:await image()},agent);
  const first=app.previews.verdict(c.id,'FAIL','Mismatch',agent);
  const duplicate=app.previews.verdict(c.id,'FAIL','Mismatch',agent);
  assert.equal(duplicate.duplicate,true);
  assert.equal(app.store.list('bug',{taskId:t.id}).length,1);
  assert.equal(app.store.list<BugThread>('bug',{taskId:t.id})[0]?.occurrences.length,1);
  assert.equal(first.bug && typeof first.bug==='object',true);
 });
});
