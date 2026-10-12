import { useState } from 'react';
import { CheckCircle2, ShieldCheck, AlertTriangle, GitCommit, Layers3 } from 'lucide-react';
import type { TaskRecord } from '../../../packages/core/src/models.js';
import { deliverySize, runnableStreams, type DecisionReportInput, type ImplementationReportInput, type Workstream } from '../../../packages/core/src/engineering.js';

type Action = (operation:string,body:Record<string,unknown>)=>Promise<unknown>;
type Panel = 'decision'|'implementation'|'parallel';
const blankDecision:DecisionReportInput={
 requirements:'',currentArchitecture:'',alternatives:[],impacts:'',recommendation:''
};
const blankImplementation:ImplementationReportInput={
 requirements:'',changes:[],technicalDecisions:'',alternativesAndTradeoffs:'',
 verification:'',deviations:'',commits:[],noChangesReason:''
};
const input=<T,>(name:string,value:T|undefined)=>JSON.stringify(value??[],null,2);
function jsonArray<T>(value:string,name:string):T[]{
 const parsed=JSON.parse(value);
 if(!Array.isArray(parsed))throw new Error(name+' must be a JSON array');
 return parsed as T[];
}
export default function EngineeringPanel({task,mode,onAction,busy}:{task:TaskRecord;mode:Panel;onAction:Action;busy:boolean}){
 const readonly=task.status==='done';
 const engineering=task.engineering;
 const decision=engineering?.decision;
 const implementation=engineering?.implementation;
 const plan=engineering?.plan;
 const [error,setError]=useState('');
 const [requirement,setRequirement]=useState(decision?.requirements||'');
 const [architecture,setArchitecture]=useState(decision?.currentArchitecture||'');
 const [alternatives,setAlternatives]=useState(input('alternatives',decision?.alternatives));
 const [impacts,setImpacts]=useState(decision?.impacts||'');
 const [recommendation,setRecommendation]=useState(decision?.recommendation||'');
 const [verdictReason,setVerdictReason]=useState('');
 const [approach,setApproach]=useState(decision?.decision?.selectedOptionId||decision?.alternatives[0]?.id||'');
 const [implRequirements,setImplRequirements]=useState(implementation?.requirements||'');
 const [changes,setChanges]=useState(input('changes',implementation?.changes));
 const [noChangesReason,setNoChangesReason]=useState(implementation?.noChangesReason||'');
 const [technicalDecisions,setTechnicalDecisions]=useState(implementation?.technicalDecisions||'');
 const [tradeoffs,setTradeoffs]=useState(implementation?.alternativesAndTradeoffs||'');
 const [verification,setVerification]=useState(implementation?.verification||'');
 const [deviations,setDeviations]=useState(implementation?.deviations||'');
 const [materialDeviation,setMaterialDeviation]=useState(implementation?.materialDeviation===true);
 const [streamEvidence,setStreamEvidence]=useState('');
 const [commits,setCommits]=useState(implementation?.commits.join('\n')||'');
 const [gitCommit,setGitCommit]=useState('');
 const [streams,setStreams]=useState(input('workstreams',plan?.workstreams));
 const [size,setSize]=useState(engineering?.size||'auto');
 const invoke=async (name:string,body:Record<string,unknown>)=>{
  try{setError('');await onAction(name,body);}catch(e){setError(e instanceof Error?e.message:String(e));}
 };
 const activeDecision=decision && decision.decision?.revision===decision.revision?decision.decision:undefined;
 return <section className="panel padded engineering-panel">
  <header className="section-row"><div><div className="mini-eyebrow">ENGINEERING STANDARD / {mode.toUpperCase()}</div>
   <h2>{mode==='decision'?'Pre-Implementation Decision Report':mode==='implementation'?'Implementation Report':'Parallel-first Execution Plan'}</h2></div>
   <span className="pill pill-blue">{deliverySize(task).toUpperCase()}</span>
  </header>
  {error&&<div role="alert" className="blocker">{error}</div>}
  {mode==='decision'&&<div className="engineering-form">
   <div className="field-row"><strong>Report revision</strong><span>{decision?.revision||'Not created'}</span></div>
   <div className="field-row"><strong>Decision</strong><span>{activeDecision?.verdict||'Pending explicit approval'}</span></div>
   {activeDecision&&<p className="muted">By {activeDecision.actor} — {activeDecision.reason}</p>}
   <label>Delivery size<select value={size} disabled={readonly||busy||task.status==='in-progress'||task.status==='ready-for-review'} onChange={e=>setSize(e.target.value as typeof size)}>
    {(['auto','small','medium','large','critical'] as const).map(s=><option key={s} value={s}>{s}</option>)}
   </select></label>
   {!readonly&&<button className="outline-button" disabled={busy} onClick={()=>invoke('engineering.size',{id:task.id,size})}>Save size</button>}
   <label>Requirements<textarea rows={3} value={requirement} disabled={readonly} onChange={e=>setRequirement(e.target.value)}/></label>
   <label>Current architecture<textarea rows={3} value={architecture} disabled={readonly} onChange={e=>setArchitecture(e.target.value)}/></label>
   <label>Alternatives (JSON array of id, title, benefits, drawbacks, effort)<textarea rows={8} value={alternatives} disabled={readonly} onChange={e=>setAlternatives(e.target.value)}/></label>
   <label>Impact analysis<textarea rows={3} value={impacts} disabled={readonly} onChange={e=>setImpacts(e.target.value)}/></label>
   <label>Recommendation<textarea rows={3} value={recommendation} disabled={readonly} onChange={e=>setRecommendation(e.target.value)}/></label>
   {!readonly&&<button className="primary-button" disabled={busy} onClick={()=>{
    try{void invoke('engineering.decision.report',{id:task.id,report:{...blankDecision,
     requirements:requirement,currentArchitecture:architecture,alternatives:jsonArray(alternatives,'Alternatives'),
     impacts,recommendation}});}catch(e){setError(String(e));}
   }}>Save decision report revision</button>}
   {decision&&<div className="engineering-decision-box">
    <h3>Approach decision</h3><p className="muted">A new revision invalidates earlier approval. Large and Critical work cannot start without an approved current revision.</p>
    <label>Selected approach<select disabled={readonly} value={approach} onChange={e=>setApproach(e.target.value)}>
     <option value="">Choose approach</option>{decision.alternatives.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}
    </select></label>
    <label>Reason<input disabled={readonly} value={verdictReason} onChange={e=>setVerdictReason(e.target.value)}/></label>
    {!readonly&&<div className="action-wrap">
     <button className="primary-button" disabled={busy||!approach||!verdictReason.trim()} onClick={()=>invoke('engineering.decision.resolve',{id:task.id,verdict:'approve',selectedOptionId:approach,reason:verdictReason})}><ShieldCheck size={15}/> Approve approach</button>
     <button className="outline-button" disabled={busy||!verdictReason.trim()} onClick={()=>invoke('engineering.decision.resolve',{id:task.id,verdict:'request-changes',reason:verdictReason})}>Request changes</button>
     <button className="danger-outline" disabled={busy||!verdictReason.trim()} onClick={()=>invoke('engineering.decision.resolve',{id:task.id,verdict:'reject',reason:verdictReason})}>Reject</button>
    </div>}
   </div>}
  </div>}
  {mode==='implementation'&&<div className="engineering-form">
   <div className="field-row"><strong>Report revision</strong><span>{implementation?.revision||'Not created'}</span></div>
   {implementation&&<div className="good-note"><CheckCircle2 size={16}/> Evidence recorded by {implementation.author}</div>}
   <label>Requirements summary<textarea rows={3} value={implRequirements} disabled={readonly} onChange={e=>setImplRequirements(e.target.value)}/></label>
   <label>Changed files (JSON array of path and summary)<textarea rows={8} value={changes} disabled={readonly} onChange={e=>setChanges(e.target.value)}/></label>
   {!readonly&&<div className="action-wrap"><input aria-label="Commit hash to import" placeholder="Git commit hash" value={gitCommit} onChange={e=>setGitCommit(e.target.value)}/>
    <button className="outline-button" type="button" disabled={busy||!/^[0-9a-f]{7,40}$/i.test(gitCommit.trim())} onClick={async()=>{
     try{setError('');const result=await onAction('engineering.git.inspect',{id:task.id,commit:gitCommit.trim()}) as {changes?:Array<{path:string;summary:string}>;commit?:string}|undefined;
      if(!result?.commit)return;
      const old=jsonArray<{path:string;summary:string}>(changes,'Changes');
      const byPath=new Map(old.map(x=>[x.path,x]));
      for(const item of result.changes||[])if(!byPath.has(item.path))byPath.set(item.path,item);
      setChanges(JSON.stringify([...byPath.values()],null,2));
      setCommits([...new Set([...commits.split(/\r?\n/).filter(Boolean),result.commit])].join('\n'));
     }catch(e){setError(String(e));}
    }}>Import verified Git files</button></div>}
   <label>No changes reason (only for verified no-op work)<input value={noChangesReason} disabled={readonly} onChange={e=>setNoChangesReason(e.target.value)}/></label>
   <label>Technical decisions<textarea rows={3} value={technicalDecisions} disabled={readonly} onChange={e=>setTechnicalDecisions(e.target.value)}/></label>
   <label>Alternatives and trade-offs<textarea rows={3} value={tradeoffs} disabled={readonly} onChange={e=>setTradeoffs(e.target.value)}/></label>
   <label>Verification evidence<textarea rows={3} value={verification} disabled={readonly} onChange={e=>setVerification(e.target.value)}/></label>
   <label>Deviations from approved plan<textarea rows={2} value={deviations} disabled={readonly} onChange={e=>setDeviations(e.target.value)}/></label>
   <label><input type="checkbox" checked={materialDeviation} disabled={readonly} onChange={e=>setMaterialDeviation(e.target.checked)}/> Material approach change — require decision approval again</label>
   <label>Git commit hashes (one per line)<textarea rows={3} value={commits} disabled={readonly} onChange={e=>setCommits(e.target.value)}/></label>
   {!readonly&&<button className="primary-button" disabled={busy} onClick={()=>{
    try{void invoke('engineering.implementation.report',{id:task.id,report:{...blankImplementation,
     requirements:implRequirements,changes:jsonArray(changes,'Changes'),noChangesReason,
     technicalDecisions,alternativesAndTradeoffs:tradeoffs,verification,deviations,materialDeviation,
     commits:commits.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}});}catch(e){setError(String(e));}
   }}><GitCommit size={15}/> Save implementation report</button>}
  </div>}
  {mode==='parallel'&&<div className="engineering-form">
   <div className="good-note"><Layers3 size={16}/> Independent streams run concurrently. Dependencies and shared file ownership are validated.</div>
   <div className="field-row"><strong>Execution policy</strong><span>Parallel-first (system standard)</span></div>
   <div className="field-row"><strong>Ready workstreams</strong><span>{runnableStreams(plan).length}</span></div>
   {(plan?.workstreams||[]).map(s=><div className="engineering-stream" key={s.id}>
    <strong>{s.title}</strong><span>{s.status}</span><small>Depends on: {s.dependsOn.join(', ')||'none'}</small>
    {!readonly&&s.status!=='done'&&<div className="action-wrap">
     {s.status==='in-progress'&&<label>Completion evidence<input value={streamEvidence} onChange={e=>setStreamEvidence(e.target.value)} placeholder="Test/commit reference"/></label>}
     {s.status==='pending'&&<button className="outline-button" disabled={busy||!runnableStreams(plan).some(x=>x.id===s.id)} onClick={()=>invoke('engineering.parallel.status',{id:task.id,streamId:s.id,status:'in-progress'})}>Start stream</button>}
     {s.status==='in-progress'&&<button className="outline-button" disabled={busy||!streamEvidence.trim()} onClick={()=>invoke('engineering.parallel.status',{id:task.id,streamId:s.id,status:'done',evidence:streamEvidence})}>Mark complete</button>}
    </div>}
   </div>)}
   <label>Execution plan (JSON array of id, title, ownedPaths, dependsOn, status)<textarea rows={10} value={streams} disabled={readonly||task.status==='ready-for-review'} onChange={e=>setStreams(e.target.value)}/></label>
   {!readonly&&task.status!=='ready-for-review'&&<button className="primary-button" disabled={busy} onClick={()=>{
    try{void invoke('engineering.parallel.plan',{id:task.id,workstreams:jsonArray(streams,'Workstreams')});}catch(e){setError(String(e));}
   }}>Save parallel plan</button>}
  </div>}
 </section>;
}
