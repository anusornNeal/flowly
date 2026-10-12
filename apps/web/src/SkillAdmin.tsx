import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {Activity,BookOpen,Check,ChevronDown,FileCheck2,GitBranch,LockKeyhole,RefreshCw,
 RotateCcw,Search,ShieldCheck,Sparkles,X} from 'lucide-react';
import {op} from './api.js';
import './skillAdmin.css';

type Skill={
 id:string; name:string; version:string; description:string; sha256:string;
 scope:'global'|'project'; source:'builtin'|'project'|'imported';
 projectId?:string; enabled:boolean;
};
type Trace={id:string;taskId?:string;at:string;skillId:string;version:string;
 reason:string;operation:string;status:string;actor:string;sha256:string};
type Proposal={id:string;skillId:string;candidateVersion:string;candidateSha256:string;
 explanation:string;createdBy:string;status:'pending'|'approved'|'rejected'|'rolled-back';
 preview:string;createdAt:string};
type Route={selected:Array<{skillId:string;version:string;reason:string}>;
 reason:string;requiresChoice?:boolean};
type Next={readOnly:true;reason:string;operation:string;blockers:string[];
 prerequisites:string[];ownership:{status:string}};
type Filter='all'|'enabled'|'disabled';
const abbreviate=(value:string,length=12)=>value.length>length?value.slice(0,length)+'…':value;
export default function SkillAdmin({projectId}:{projectId:string}){
 const [skills,setSkills]=useState<Skill[]>([]);
 const [traces,setTraces]=useState<Trace[]>([]);
 const [proposals,setProposals]=useState<Proposal[]>([]);
 const [next,setNext]=useState<Next|null>(null);
 const [intent,setIntent]=useState('Continue implementing the next eligible card');
 const [allowProjectGuidance,setAllowProjectGuidance]=useState(false);
 const [route,setRoute]=useState<Route|null>(null);
 const [filter,setFilter]=useState<Filter>('all');
 const [query,setQuery]=useState('');
 const [selectedSkill,setSelectedSkill]=useState<Skill|null>(null);
 const [skillText,setSkillText]=useState('');
 const [candidateText,setCandidateText]=useState('');
 const [candidateVersion,setCandidateVersion]=useState('1.1.0');
 const [explanation,setExplanation]=useState('');
 const [selectedProposal,setSelectedProposal]=useState<Proposal|null>(null);
 const [decisionReason,setDecisionReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!projectId)return;
  const [catalog,proposalsData,auditData,action]=await Promise.all([
   op<Skill[]>('skills.list',{projectId,includeDisabled:true}),
   op<Proposal[]>('skills.learning.list',{projectId,includeClosed:true}),
   op<Trace[]>('skills.audit.list',{projectId,limit:20}),
   op<Next>('next',{projectId})
  ]);
  setSkills(catalog);setProposals(proposalsData);setTraces(auditData);setNext(action);
 },[projectId]);
 useEffect(()=>{
  let active=true;
  setSkills([]);setTraces([]);setProposals([]);setNext(null);setRoute(null);setSelectedSkill(null);
  setError('');setNotice('');
  if(!projectId)return;
  Promise.all([op<Skill[]>('skills.list',{projectId,includeDisabled:true}),
   op<Proposal[]>('skills.learning.list',{projectId,includeClosed:true}),
   op<Trace[]>('skills.audit.list',{projectId,limit:20}),op<Next>('next',{projectId})])
  .then(([catalog,pending,history,recommendation])=>{
   if(active){setSkills(catalog);setProposals(pending);setTraces(history);setNext(recommendation);}
  }).catch(e=>{if(active)setError(String(e));});
  return()=>{active=false;};
 },[projectId]);
 const mutate=async(work:()=>Promise<unknown>,message:string)=>{
  setBusy(true);setError('');setNotice('');
  try{await work();await refresh();setNotice(message);}
  catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setBusy(false);}
 };
 const visible=useMemo(()=>skills.filter(s=>
   (filter==='all'||(filter==='enabled')===s.enabled) &&
   (s.name+' '+s.description).toLowerCase().includes(query.toLowerCase())),[skills,filter,query]);
 const toggle=async(skill:Skill)=>mutate(()=>op('skills.enable',{id:skill.id,
  ...(skill.scope==='project'?{projectId,version:skill.version}:{}),enabled:!skill.enabled}),
   skill.enabled?'Skill disabled.':'Skill enabled.');
 const view=async(skill:Skill)=>{
  setSelectedSkill(skill);setSkillText('');setError('');
  try{
   const result=await op<{content:string}>('skills.get',{id:skill.id,projectId,version:skill.version});
   setSkillText(result.content);setCandidateText(result.content);
   const v=skill.version.split('.').map(Number);
   setCandidateVersion(v.length===3?String(v[0])+'.'+String(v[1]+1)+'.0':'1.1.0');
  }catch(e){setError(String(e));}
 };
 const previewRoute=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');
  try{setRoute(await op<Route>('skills.route',{projectId,intent,allowProjectGuidance}));}
  catch(e){setError(String(e));}finally{setBusy(false);}
 };
 const propose=async(e:FormEvent)=>{
  e.preventDefault();if(!selectedSkill||selectedSkill.scope!=='project')return;
  await mutate(()=>op('skills.learning.propose',{projectId,skillId:selectedSkill.id,
   candidateVersion,candidateContent:candidateText,explanation}), 'Proposal recorded for independent review.');
 };
 const decide=async(verdict:'approve'|'reject'|'rollback')=>{
  const proposal=selectedProposal;
  if(!proposal)return;
  if(decisionReason.trim().length<8){setError('Provide a decision reason (minimum 8 characters).');return;}
  if(verdict==='approve'&&!window.confirm('Approve exact Skill revision '+proposal.candidateVersion+
    ' / '+proposal.candidateSha256.slice(0,12)+'? This modifies the project Skill catalog.'))return;
  if(verdict==='rollback'&&!window.confirm('Roll back approved Skill revision '+proposal.candidateVersion+'?'))return;
  await mutate(()=>verdict==='rollback'
   ?op('skills.learning.rollback',{projectId,id:proposal.id,confirm:'ROLLBACK:'+proposal.id,reason:decisionReason})
   :op('skills.learning.decide',{projectId,id:proposal.id,verdict,
     confirm:verdict==='approve'?'APPLY:'+proposal.candidateSha256.slice(0,12):undefined,reason:decisionReason}),
     'Proposal decision audited.');
  setSelectedProposal(null);
 };
 return <section className="skill-admin">
  <header className="page-heading">
   <div><div className="eyebrow">AGENT GUIDANCE / TRUSTED LOCAL DATA</div>
    <h1>Skill Engine<span className="dot">.</span></h1>
    <p>Inspect available guidance, route decisions and approval history. Backend gates remain authoritative.</p>
   </div>
   <button className="outline-button" type="button" disabled={busy||!projectId}
    onClick={()=>void refresh().catch(e=>setError(String(e)))}><RefreshCw size={16}/> Refresh</button>
  </header>
  {(notice||error)&&<div className={'skill-alert'+(error?' skill-alert-error':'')} role="status">
   {error||notice}<button aria-label="Dismiss message" onClick={()=>{setError('');setNotice('');}}><X size={15}/></button></div>}
  <div className="skill-kpis" aria-label="Skill Engine statistics">
   <article><span>Available Skills</span><strong>{skills.length}</strong><small>Metadata verified locally</small></article>
   <article><span>Enabled</span><strong>{skills.filter(s=>s.enabled).length}</strong><small>Current catalog</small></article>
   <article><span>Proposals awaiting review</span><strong>{proposals.filter(p=>p.status==='pending').length}</strong><small>No automatic promotions</small></article>
   <article><span>Recent guidance traces</span><strong>{traces.length}</strong><small>Last 20 audit records</small></article>
  </div>
  <div className="skill-two-column">
   <section className="panel skill-panel">
    <header className="skill-panel-head"><div><div className="mini-eyebrow">CATALOG</div><h2>Versioned skills</h2>
     <p>Project-specific changes require explicit confirmation</p></div><BookOpen size={19}/></header>
    <div className="skill-toolbar"><label className="skill-search"><Search size={15}/>
     <input aria-label="Filter skills" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a skill…"/></label>
     <label className="skill-filter">Show <select aria-label="Skill status filter" value={filter} onChange={e=>setFilter(e.target.value as Filter)}>
      <option value="all">All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
     </select><ChevronDown size={13}/></label></div>
    <div className="skill-catalog">
     {!visible.length&&<div className="skill-blank">No matching Skill entries.</div>}
     {visible.map(skill=><div className="skill-line" key={skill.id+'@'+skill.version}>
      <div className="skill-line-copy"><div className="skill-line-title"><strong>{skill.name}</strong>
       <span className="skill-version">v{skill.version}</span>
       <span className={'skill-status '+(skill.enabled?'is-on':'is-off')}>{skill.enabled?'Enabled':'Disabled'}</span></div>
       <p>{skill.description}</p><small>{skill.scope==='global'?'Built-in / global':'Project scoped'} · {abbreviate(skill.sha256,12)}</small></div>
      <div className="skill-actions"><button type="button" disabled={busy} onClick={()=>void view(skill)}>Details</button>
       <button type="button" className="skill-icon-action" title={skill.enabled?'Disable Skill':'Enable Skill'}
        aria-label={(skill.enabled?'Disable ':'Enable ')+skill.name} disabled={busy} onClick={()=>void toggle(skill)}>
        {skill.enabled?<LockKeyhole size={16}/>:<Check size={16}/>}</button>
      </div></div>)}
    </div>
   </section>
   <div className="skill-right-column">
    <section className="panel skill-panel">
     <header className="skill-panel-head"><div><div className="mini-eyebrow">AGENT ORCHESTRATION</div>
      <h2>Next safe action</h2><p>Read-only guidance from the current project</p></div><GitBranch size={18}/></header>
     {next?<div className="skill-next"><span className="skill-reason">{next.reason}</span>
       <strong>{next.operation}</strong>
       {next.blockers.length>0&&<p>Blocked: {next.blockers.join(', ')}</p>}
       <small>Ownership state: {next.ownership?.status||'not available'}. No transition is performed.</small>
      </div>:<div className="skill-blank">Project context required.</div>}
    </section>
    <section className="panel skill-panel">
     <header className="skill-panel-head"><div><div className="mini-eyebrow">CONTEXT-AWARE ROUTING</div><h2>Inspect route</h2>
      <p>Preview chosen Skills without triggering workflow actions</p></div><Sparkles size={18}/></header>
     <form onSubmit={previewRoute} className="skill-route-form">
      <label htmlFor="skill-intent">Agent intent</label><textarea id="skill-intent" rows={2} value={intent} onChange={e=>setIntent(e.target.value)}/>
      <label className="skill-project-opt"><input type="checkbox" checked={allowProjectGuidance} onChange={e=>setAllowProjectGuidance(e.target.checked)} />Include project guidance</label>
      <button className="outline-button" type="submit" disabled={busy||!intent.trim()}>Evaluate route</button>
     </form>
     {route&&<div className="skill-route-result"><small>Reason: {route.reason}</small>
      {route.selected.length?route.selected.map(s=><div key={s.skillId+'@'+s.version}><ShieldCheck size={15}/>
       <span>{s.skillId} · v{s.version} · {s.reason}</span></div>):<p>No eligible Skill. Check project scope.</p>}</div>}
    </section>
   </div>
  </div>
  {selectedSkill&&<section className="panel skill-panel skill-editor">
   <header className="skill-panel-head"><div><div className="mini-eyebrow">SKILL DETAILS / {selectedSkill.source.toUpperCase()}</div>
     <h2>{selectedSkill.name} <span className="skill-version">v{selectedSkill.version}</span></h2>
     <p>Full content is informational, never an executable workflow override</p></div>
    <button className="skill-icon-action" aria-label="Close Skill details" onClick={()=>setSelectedSkill(null)}><X size={18}/></button></header>
   <pre className="skill-text-preview">{skillText||'Loading content…'}</pre>
   {selectedSkill.scope==='project'&&<form className="skill-proposal-form" onSubmit={propose}>
    <div className="skill-fields"><label>Candidate version<input aria-label="Candidate version" value={candidateVersion} onChange={e=>setCandidateVersion(e.target.value)} required/></label>
     <label>Reason for change<input aria-label="Change reason" value={explanation} onChange={e=>setExplanation(e.target.value)}
      placeholder="Which wrong agent behavior does this fix?" required minLength={12}/></label></div>
    <label>Candidate SKILL.md<textarea aria-label="Candidate Skill content" rows={7} value={candidateText}
     onChange={e=>setCandidateText(e.target.value)} required/></label>
    <button type="submit" className="outline-button" disabled={busy}>Create review proposal</button>
    <p className="skill-disclaimer">The current version stays active until an independent reviewer explicitly approves the proposal.</p>
   </form>}
  </section>}
  <div className="skill-two-column skill-footer-panels">
   <section className="panel skill-panel">
    <header className="skill-panel-head"><div><div className="mini-eyebrow">HUMAN-GOVERNED LEARNING</div><h2>Review proposals</h2></div><FileCheck2 size={18}/></header>
    <div className="skill-timeline">
     {!proposals.length&&<div className="skill-blank">No proposal history for this project.</div>}
     {proposals.slice(0,20).map(p=><button key={p.id} type="button"
      className={'skill-history-item'+(selectedProposal?.id===p.id?' selected':'')} onClick={()=>setSelectedProposal(p)}>
      <span><strong>{p.skillId}</strong> <span className="skill-version">→ v{p.candidateVersion}</span></span>
      <small>{p.status} · {new Date(p.createdAt).toLocaleString()}</small>
      <p>{p.explanation}</p></button>)}
    </div>
    {selectedProposal&&<div className="skill-decision-form">
     <strong>{selectedProposal.skillId} / {selectedProposal.candidateSha256.slice(0,12)}</strong>
     <p>{selectedProposal.preview}</p>
     <label>Decision reason<input aria-label="Proposal decision reason" value={decisionReason} onChange={e=>setDecisionReason(e.target.value)}/></label>
     <div className="skill-decision-actions">
      {selectedProposal.status==='pending'&&<><button disabled={busy} className="primary-button" onClick={()=>void decide('approve')}>Approve</button>
       <button disabled={busy} className="outline-button" onClick={()=>void decide('reject')}>Reject</button></>}
      {selectedProposal.status==='approved'&&<button disabled={busy} className="outline-button" onClick={()=>void decide('rollback')}>
       <RotateCcw size={15}/> Rollback</button>}
     </div>
    </div>}
   </section>
   <section className="panel skill-panel">
    <header className="skill-panel-head"><div><div className="mini-eyebrow">AUDIT TRAIL</div>
     <h2>Recent Skill decisions</h2><p>Explicit recorded selections, not inferred activity</p></div><Activity size={18}/></header>
    <div className="skill-timeline">
     {!traces.length&&<div className="skill-blank">No Skill provenance entries yet.</div>}
     {traces.map(t=><div key={t.id} className="skill-history-item">
      <span><strong>{t.skillId}</strong> <span className="skill-version">v{t.version}</span></span>
      <small>{t.status} · {t.reason}</small><p>{t.operation} · {new Date(t.at).toLocaleString()}</p>
     </div>)}
    </div>
   </section>
  </div>
 </section>;
}
