import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Activity, AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Check, CheckCircle2, ChevronDown, CircleDashed,
 Clipboard, Code2, Eye, FileImage, FolderKanban, Grid2X2, History, Image, ListChecks, Monitor, MoreHorizontal,
 Plus, RefreshCw, Save, Search, Settings, ShieldCheck, Terminal, Trash2, Upload, WandSparkles, X } from 'lucide-react';
import type { Actor, ChecklistItem, Preview, Project, QaCase, ScreenSpec, Screenshot, TaskRecord } from '../../../packages/core/src/models.js';
import { type Detail, type Snapshot, get, op, upload, dateLabel, fileUrl, baselineUrl, diffUrl } from './api.js';

type Page='overview'|'board'|'task'|'preview'|'settings';
type Tab='summary'|'checklist'|'subtasks'|'bugs'|'qa'|'history';
const lanes=['backlog','todo','in-progress','ready-for-review','done'] as const;
const laneNames:Record<string,string>={'backlog':'Backlog','todo':'To-do','in-progress':'In progress','ready-for-review':'Ready for review','done':'Done'};
const humanStatus=(v:string)=>laneNames[v]||v.replaceAll('-',' ');
const dateTime=(v?:string)=>dateLabel(v);
const amount=(v:number)=>v>=1048576?(v/1048576).toFixed(1)+' MB':(v/1024).toFixed(1)+' KB';
const safeJson=(text:string,label:string):any=>{try{return JSON.parse(text);}catch{throw new Error('Invalid JSON: '+label);}};
const defaultScreen=():ScreenSpec=>({id:'screen-'+Math.random().toString(36).slice(2,7),name:'New screen',stateId:'default',viewport:{width:1280,height:800,device:'desktop'},required:true});
const navList:[Page,typeof Grid2X2][]=[['overview',Grid2X2],['board',FolderKanban],['task',ListChecks],['preview',FileImage],['settings',Settings]];
function Pill({children,tone='neutral'}:{children:React.ReactNode;tone?:string}){return <span className={'pill pill-'+tone}>{children}</span>;}
function Empty({title,body}:{title:string;body?:string}){return <div className="empty"><CircleDashed size={24}/><strong>{title}</strong>{body&&<p>{body}</p>}</div>;}
function Stamp({value}:{value?:string}){return <time>{dateTime(value)}</time>;}
export default function App(){
 const [page,setPage]=useState<Page>('overview');
 const [projects,setProjects]=useState<Project[]>([]);
 const [projectId,setProjectId]=useState<string>(localStorage.getItem('flowly-project')||'');
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [selectedTask,setSelectedTask]=useState<string>('');
 const [selectedPreview,setSelectedPreview]=useState<string>('');
 const [detail,setDetail]=useState<Detail|null>(null);
 const [tab,setTab]=useState<Tab>('summary');
 const [search,setSearch]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<{text:string;error:boolean}|null>(null);
 const [showCreateProject,setShowCreateProject]=useState(false);
 const [projectName,setProjectName]=useState('');
 const [projectPlatform,setProjectPlatform]=useState<'web'|'desktop'|'mobile'>('web');
 const [projectUrl,setProjectUrl]=useState('');
 const [taskTitle,setTaskTitle]=useState('');
 const [taskDescription,setTaskDescription]=useState('');
 const [taskReason,setTaskReason]=useState('');
 const [checkText,setCheckText]=useState('');
 const [bugText,setBugText]=useState('');
 const [taskEdit,setTaskEdit]=useState<{title:string;description:string;acceptanceCriteria:string;verificationStep:string}>({title:'',description:'',acceptanceCriteria:'',verificationStep:''});
 const [previewName,setPreviewName]=useState('');
 const [previewResetKey,setPreviewResetKey]=useState(0);
 const previewFrame=useRef<HTMLIFrameElement|null>(null);
 const [previewTaskId,setPreviewTaskId]=useState('');
 const [draft,setDraft]=useState<Preview['draft']|null>(null);
 const [sourceTab,setSourceTab]=useState<'html'|'css'|'js'>('html');
 const [screenIndex,setScreenIndex]=useState(0);
 const [selectedCase,setSelectedCase]=useState('');
 const [compareMode,setCompareMode]=useState<'side'|'overlay'|'diff'>('side');
 const [qaReason,setQaReason]=useState('');
 const [proof,setProof]=useState('');
 const [token,setToken]=useState('');
 const [storage,setStorage]=useState<{originals:number;thumbnails:number;bytes:number}>({originals:0,thumbnails:0,bytes:0});
 const [deletedShown,setDeletedShown]=useState(false);
 const [historyImages,setHistoryImages]=useState<Screenshot[]>([]);
 const [selectedImages,setSelectedImages]=useState<string[]>([]);
 const [urlDraft,setUrlDraft]=useState('');
 const [contextDraft,setContextDraft]=useState('{}');
 const [sourcePathDraft,setSourcePathDraft]=useState('');
 const [contextInfo,setContextInfo]=useState<{changed:boolean;currentContext:Record<string,unknown>;revisions:Array<{revisionId:string;version:number;approved:boolean;changed:boolean}>}|null>(null);
 const [recording,setRecording]=useState(false);
 const [recipeText,setRecipeText]=useState('[]');
 const [previewAcceptWarnings,setPreviewAcceptWarnings]=useState(false);
 const [previewWarningReason,setPreviewWarningReason]=useState('');
 const [renderQa,setRenderQa]=useState<{revisionId:string;passed:boolean;screens:Array<{screen:string;state:string;critical:number;warnings:number;issues:Array<{code:string;severity:string;message:string;selector?:string;suggestion?:string}>}>}|null>(null);

 const project=useMemo(()=>projects.find(p=>p.id===projectId),[projectId,projects]);
 const tasks=snapshot?.tasks||[];
 const previews=snapshot?.previews||[];
 const cases=snapshot?.cases||[];
 const activeTask=detail?.task||tasks.find(t=>t.id===selectedTask);
 const activePreview=previews.find(p=>p.id===selectedPreview);
 const activeCase=cases.find(c=>c.id===selectedCase);
 const caseImage=snapshot?.screenshots.find(s=>s.id===activeCase?.evidenceId);
 const taskCases=cases.filter(c=>c.taskId===selectedTask);
 const counts=Object.fromEntries(lanes.map(lane=>[lane,tasks.filter(t=>t.status===lane).length]));
 const filteredTasks=tasks.filter(t=>(t.title+' '+t.displayId+' '+t.description).toLowerCase().includes(search.toLowerCase()));
 const currentSnapshot=useCallback(async(id:string)=>{
  const d=await get<Snapshot>('snapshot/'+encodeURIComponent(id));
  setSnapshot(d);
 },[]);
 const refreshProjects=useCallback(async()=>{
  const d=await get<Project[]>('projects');setProjects(d);
  if(!d.length){setShowCreateProject(true);return;}
  setProjectId(previous=>d.some(p=>p.id===previous)?previous:d[0]!.id);
 },[]);
 const refresh=useCallback(async()=>{
  if(!projectId)return;
  await currentSnapshot(projectId);
 },[projectId,currentSnapshot]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!id)return;
  const d=await get<Detail>('tasks/'+encodeURIComponent(id));
  setDetail(d);
  setTaskEdit({title:d.task.title,description:d.task.description,acceptanceCriteria:d.task.acceptanceCriteria,verificationStep:d.task.verificationStep});
 },[]);
 useEffect(()=>{refreshProjects().catch(e=>setNotice({text:String(e),error:true}));},[refreshProjects]);
 useEffect(()=>{
  if(!projectId)return;
  localStorage.setItem('flowly-project',projectId);
  setSelectedTask('');setSelectedPreview('');setSelectedCase('');setDetail(null);
  refresh().catch(e=>setNotice({text:String(e),error:true}));
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{});},6000);
  return ()=>clearInterval(timer);
 },[projectId,refresh]);
 useEffect(()=>{if(selectedTask)loadDetail(selectedTask).catch(e=>setNotice({text:String(e),error:true}));},[selectedTask,loadDetail]);
 useEffect(()=>{
  if(activePreview){
   setDraft(structuredClone(activePreview.draft));
   setScreenIndex(0);
   op<{changed:boolean;currentContext:Record<string,unknown>;revisions:Array<{revisionId:string;version:number;approved:boolean;changed:boolean}>}>('preview.context',{id:activePreview.id}).then(setContextInfo).catch(()=>setContextInfo(null));
  }
 },[selectedPreview]); // Selecting a Preview intentionally starts a fresh editor draft.
 useEffect(()=>{
  if(project){setUrlDraft(project.baseUrl||'');setContextDraft(JSON.stringify(project.uiContext,null,2));setSourcePathDraft(project.sourcePath||'');}
 },[project?.id,project?.updatedAt]);
 const notify=(text:string,error=false)=>setNotice({text,error});
 const doAction=async<T=unknown>(operation:string,body:Record<string,unknown>={}):Promise<T|undefined>=>{
  if(busy)return;
  setBusy(true);
  try{
   const response=await op<T>(operation,body);
   await refresh();
   if(selectedTask)await loadDetail(selectedTask);
   notify('Saved successfully');return response;
  }catch(error){notify(error instanceof Error?error.message:String(error),true);}
  finally{setBusy(false);}
 };
 const chooseTask=(id:string)=>{setSelectedTask(id);setPage('task');setTab('summary');};
 const choosePreview=(id:string)=>{setSelectedPreview(id);setPage('preview');setSelectedCase('');};
 const createProject=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);
  try{
   const p=await op<Project>('project.create',{name:projectName,platform:projectPlatform,baseUrl:projectUrl||undefined});
   await refreshProjects();setProjectId(p.id);setProjectName('');setShowCreateProject(false);notify('Workspace created');
  }catch(error){notify(String(error),true);}finally{setBusy(false);}
 };
 const createTask=async(e:FormEvent)=>{
  e.preventDefault();if(!projectId)return;
  const created=await doAction<TaskRecord>('task.create',{projectId,title:taskTitle,description:taskDescription});
  if(created){setTaskTitle('');setTaskDescription('');}
 };
 const uploadCase=async(e:ChangeEvent<HTMLInputElement>,qa:QaCase)=>{
  const file=e.currentTarget.files?.[0];if(!file)return;
  setBusy(true);
  try{
   await upload(file,{projectId,taskId:qa.taskId,screenId:qa.screenId,caseId:qa.id});
   await refresh();if(selectedTask)await loadDetail(selectedTask);setSelectedCase(qa.id);notify(qa.verdict==='WAIVED'?'Screenshot recorded; waiver retained. Compare is awaiting review.':'Screenshot recorded; QA verdict is pending.');
  }catch(error){notify(String(error),true);}finally{setBusy(false);e.target.value='';}
 };
 const changeCase=async(id:string,verdict:'PASS'|'FAIL'|'WAIVED')=>{
  await doAction('qa.verdict',{id,verdict,reason:qaReason});setQaReason('');
 };
 const statusSelect=(id:string,status:string)=>{
  void doAction('task.transition',{id,to:status}).then(()=>{if(selectedTask===id)void loadDetail(id);});
 };
 const submitPreview=async()=>{
  if(!activePreview||!draft)return;
  await doAction('preview.draft',{id:activePreview.id,html:draft.html,css:draft.css,js:draft.js,screens:draft.screens});
 };
 const saveRevision=async()=>{
  if(!activePreview||!draft)return;
  setBusy(true);
  try{
   await op('preview.draft',{id:activePreview.id,...draft});
   const rev=await op<{id:string;version:number}>('preview.revision.save',{id:activePreview.id});
   await refresh();notify('Revision '+rev.version+' frozen. Approve explicitly when ready.');
  }catch(error){notify(String(error),true);}finally{setBusy(false);}
 };
 const approveRevision=async(revisionId:string)=>{
  if(!activePreview||!window.confirm('Approve this immutable Preview revision and generate fresh QA cases?'))return;
  const result=await doAction('preview.approve',{id:activePreview.id,revisionId,acceptWarnings:previewAcceptWarnings,warningReason:previewWarningReason});
  if(result){setPreviewAcceptWarnings(false);setPreviewWarningReason('');}
 };
 const recordAction=async(name:string,payload:Record<string,unknown>)=>{
  const response=await doAction(name,payload);
  if(response&&name==='recorder.start')setRecording(true);
  if(response&&name==='recorder.stop')setRecording(false);
 };
 const loadStorage=async()=>{
  try{
   const [totals,history]=await Promise.all([op<{originals:number;thumbnails:number;bytes:number}>('screenshot.storage',{}),op<Screenshot[]>('screenshot.list',{projectId,includeDeleted:true})]);
   setStorage(totals);setHistoryImages(history);
  }catch(error){notify(String(error),true);}
 };
 useEffect(()=>{if(page==='settings')void loadStorage();},[page,snapshot?.screenshots.length]);

 const recent=snapshot?.activity||[];
 const attention=tasks.filter(t=>t.status==='ready-for-review'||t.status==='in-progress'&&
  cases.some(c=>c.taskId===t.id&&c.required&&!['PASS','WAIVED'].includes(c.verdict||''))).slice(0,6);
 const screens=draft?.screens||[];
 const visibleScreenshots=deletedShown?historyImages.filter(s=>s.status==='deleted'):(snapshot?.screenshots||[]);
 const menuName:Record<Page,string>={overview:'Overview',board:'Task Board',task:'Task Detail',preview:'Preview & Visual QA',settings:'Settings'};
 return <div className="flowly-app">
  <aside className="sidebar">
   <div className="brand"><div className="brand-mark"><span/><span/><span/><span/></div><strong>flowly</strong></div>
   <div className="brand-sub">LOCAL WORKSPACE <span>V1</span></div>
   <label className="workspace-selector"><span className="workspace-icon">F</span><span className="workspace-copy"><small>ACTIVE PROJECT</small>
    <select value={projectId} onChange={e=>setProjectId(e.target.value)} aria-label="Select project">
     {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select></span><ChevronDown size={15}/></label>
   <span className="nav-eyebrow">WORKSPACE</span>
   <nav className="nav-list" aria-label="Main navigation">
    {navList.slice(0,4).map(([key,Icon])=><button key={key} type="button" className={'nav-btn'+(page===key?' is-active':'')} onClick={()=>setPage(key)}>
     <Icon size={18}/><span>{menuName[key]}</span>{key==='board'&&<em>{tasks.length}</em>}
    </button>)}
   </nav>
   <span className="nav-eyebrow section-space">PREFERENCES</span>
   <nav className="nav-list"><button type="button" className={'nav-btn'+(page==='settings'?' is-active':'')} onClick={()=>setPage('settings')}><Settings size={18}/> Settings</button></nav>
   <div className="sidebar-tail">
    <div className="agent-summary"><span className="status-dot"/><strong>Local-first workspace</strong><p>CLI and Web share the same audited state.</p><button onClick={()=>setPage('overview')}>View activity <ArrowRight size={13}/></button></div>
    <div className="local-profile"><span>F</span><div><strong>Single-user</strong><small>localhost only</small></div><ShieldCheck size={15}/></div>
   </div>
  </aside>
  <div className="main-shell">
   <header className="topbar">
    <div className="breadcrumb">Workspace <span>/</span><strong>{menuName[page]}</strong></div>
    <div className="topbar-tools"><label className="top-search"><Search size={15}/><input aria-label="Search tasks" placeholder="Search tasks…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
     <button className="icon-button" title="Refresh" onClick={()=>void refresh()}><RefreshCw size={17}/></button>
     <Pill tone="green">LOCAL</Pill>
    </div>
   </header>
   {notice&&<div className={'toast'+(notice.error?' error':'')} role="status"><span>{notice.text}</span><button title="Dismiss" onClick={()=>setNotice(null)}><X size={15}/></button></div>}
   <main className="main-content">
    {page==='overview'&&<>
     <header className="page-heading"><div><div className="eyebrow">WORKSPACE PULSE / LIVE DATA</div><h1>Keep every delivery in view<span className="dot">.</span></h1><p>Tasks, agent actions and quality gates in one place.</p></div>
     <button className="outline-button" onClick={()=>void refresh()}><RefreshCw size={15}/> Refresh</button></header>
     {project?<><section className="stat-grid">
      {([['Tasks',tasks.filter(t=>t.status!=='done').length,'5 workflow lanes',FolderKanban],
        ['In progress',counts['in-progress']||0,'Work currently active',Activity],
        ['Ready for review',counts['ready-for-review']||0,'Waiting on a decision',Bell],
        ['QA Passed',cases.filter(c=>c.verdict==='PASS').length,'of '+cases.length+' current cases',ShieldCheck]
       ] as const).map(([title,count,sub,Icon])=><button className="stat-card" key={String(title)} onClick={()=>setPage(title==='QA Passed'?'preview':'board')}>
       <div><span>{String(title)}</span><Icon size={20}/></div><strong>{String(count).padStart(2,'0')}</strong><small>{String(sub)}</small></button>)}
     </section>
     <div className="overview-grid">
      <section className="panel"><header className="panel-head"><div><div className="mini-eyebrow">DELIVERY</div><h2>Workflow overview</h2><p>Current task distribution</p></div></header>
       <div className="stage-bars">{lanes.map(lane=><button key={lane} className="stage-row" onClick={()=>setPage('board')}><span>{humanStatus(lane)}</span>
       <div className="stage-track"><i style={{width:Math.max(1,(counts[lane]||0)/(tasks.length||1)*100)+'%'}}/></div><strong>{counts[lane]||0}</strong></button>)}</div></section>
      <section className="panel"><header className="panel-head"><div><div className="mini-eyebrow">PRIORITIES</div><h2>Needs attention</h2><p>Review and QA blockers</p></div><Pill tone="amber">{attention.length}</Pill></header>
       <div className="attention-list">{attention.length?attention.map(t=><button className="attention-row" key={t.id} onClick={()=>chooseTask(t.id)}>
        <AlertCircle size={19}/><span><strong>{t.title}</strong><small>{t.displayId} · {humanStatus(t.status)}</small></span><ArrowRight size={15}/></button>):
        <Empty title="No immediate blockers" body="Work requiring attention will appear here."/>}</div></section>
     </div>
     <div className="overview-grid second">
      <section className="panel"><header className="panel-head"><div><div className="mini-eyebrow">AUDIT TRAIL</div><h2>Recent agent and user activity</h2><p>Actual persisted actions, not simulated runs</p></div><History size={18}/></header>
       <ActivityList items={recent.slice(0,12)}/></section>
      <section className="panel"><header className="panel-head"><div><div className="mini-eyebrow">VISUAL QA</div><h2>Evidence summary</h2><p>Current Approved revisions</p></div></header>
       <div className="qa-overview">{(['PASS','FAIL','WAIVED','PENDING'] as const).map(status=><button key={status} onClick={()=>setPage('preview')}>
        <span className={'qa-dot q-'+status.toLowerCase()}/><span>{status==='PENDING'?'Awaiting verdict':status}</span>
        <strong>{cases.filter(c=>status==='PENDING'?!c.verdict:c.verdict===status).length}</strong></button>)}</div></section>
     </div></>:<Empty title="No project selected" body="Create a local workspace to start tracking tasks."/>}
    </>}
    {page==='board'&&<>
     <header className="page-heading"><div><div className="eyebrow">DELIVERY WORKFLOW</div><h1>Task Board<span className="dot">.</span></h1><p>Five lanes with audit-backed transitions and explicit Done gates.</p></div>
      <button className="primary-button" onClick={()=>document.getElementById('new-task-title')?.focus()}><Plus size={16}/> New task</button></header>
     <form className="quick-create" onSubmit={createTask}><input id="new-task-title" placeholder="New task title" value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} required/>
      <input placeholder="Optional description" value={taskDescription} onChange={e=>setTaskDescription(e.target.value)}/><button className="primary-button" disabled={!projectId||busy}>Create</button></form>
     <div className="board-scroll"><div className="board-columns">{lanes.map(lane=><section key={lane} className="board-lane"
       onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(id)statusSelect(id,lane);}}>
      <header><span className={'lane-indicator lane-'+lane}/><h2>{humanStatus(lane)}</h2><em>{counts[lane]||0}</em></header>
      <div className="lane-items">{filteredTasks.filter(t=>t.status===lane).map(t=><button draggable key={t.id}
       onDragStart={e=>e.dataTransfer.setData('text/plain',t.id)} className="board-task" onClick={()=>chooseTask(t.id)}>
       <div className="task-card-overline"><span>{t.displayId}</span><Pill tone={t.priority==='high'?'red':t.priority==='medium'?'amber':'neutral'}>{t.priority}</Pill></div>
       <strong>{t.title}</strong>{t.description&&<p>{t.description}</p>}
       <div className="task-card-footer"><span><ListChecks size={13}/> {t.checklist.filter(i=>i.done).length}/{t.checklist.length}</span>
        {t.childIds.length>0&&<span><FolderKanban size={13}/> {t.childIds.length} subtasks</span>}
        <span>{t.type==='bug'?'BUG':t.reviewMode==='auto'?'AUTO REVIEW':'REVIEW'}</span>
       </div></button>)}{filteredTasks.filter(t=>t.status===lane).length===0&&<div className="lane-empty">No tasks</div>}</div>
     </section>)}</div></div>
    </>}
    {page==='task'&&<>{!activeTask?<Empty title="Choose a task" body="Select a card from the Board to inspect its activity and workflow."/>:<>
     <header className="page-heading task-heading"><div><button className="text-button" onClick={()=>setPage('board')}><ArrowLeft size={15}/> Back to Board</button>
      <div className="eyebrow">{activeTask.displayId} / {activeTask.type.toUpperCase()}</div><h1>{activeTask.title}</h1>
      <p>Last updated <Stamp value={activeTask.updatedAt}/></p></div>
      <div className="action-cluster"><Pill tone={activeTask.status==='done'?'green':'blue'}>{humanStatus(activeTask.status)}</Pill>
       {activeTask.status!=='done'&&<select aria-label="Change lane" value={activeTask.status} onChange={e=>statusSelect(activeTask.id,e.target.value)}>
        {lanes.map(l=><option value={l} key={l}>{humanStatus(l)}</option>)}</select>}</div></header>
     <div className="detail-tabs">{(['summary','checklist','subtasks','bugs','qa','history'] as Tab[]).map(t=><button key={t} className={t===tab?'active':''} onClick={()=>setTab(t)}>{humanStatus(t)}
     {t==='bugs'&&!!detail?.bugs.length&&<span>{detail.bugs.length}</span>}</button>)}</div>
     {tab==='summary'&&<div className="detail-grid"><section className="panel padded"><div className="mini-eyebrow">TASK INFORMATION</div><h2>Scope and acceptance</h2>
      <label>Title<input value={taskEdit.title} disabled={activeTask.status==='done'} onChange={e=>setTaskEdit({...taskEdit,title:e.target.value})}/></label>
      <label>Description<textarea rows={4} value={taskEdit.description} disabled={activeTask.status==='done'} onChange={e=>setTaskEdit({...taskEdit,description:e.target.value})}/></label>
      <label>Acceptance criteria<textarea rows={3} value={taskEdit.acceptanceCriteria} disabled={activeTask.status==='done'} onChange={e=>setTaskEdit({...taskEdit,acceptanceCriteria:e.target.value})}/></label>
      <label>Verification step<textarea rows={2} value={taskEdit.verificationStep} disabled={activeTask.status==='done'} onChange={e=>setTaskEdit({...taskEdit,verificationStep:e.target.value})}/></label>
      {activeTask.status!=='done'&&<button className="primary-button" disabled={busy} onClick={()=>void doAction('task.update',{id:activeTask.id,...taskEdit})}><Save size={15}/> Save task</button>}</section>
      <section className="detail-stack">
       <div className="panel padded"><div className="mini-eyebrow">QUALITY GATES</div><h2>Done readiness</h2>
        {detail?.blockers.length?detail.blockers.map(block=><div className="blocker" key={block}><AlertCircle size={14}/>{humanStatus(block.replaceAll('_',' ').toLowerCase())}</div>):
         <div className="good-note"><CheckCircle2 size={16}/> All currently evaluated gates satisfied</div>}
        <div className="field-row"><strong>Risk assessment</strong><Pill tone={detail?.risk==='HIGH'?'red':detail?.risk==='MEDIUM'?'amber':'green'}>{detail?.risk||'MEDIUM'}</Pill></div>
        <div className="field-row"><strong>Review policy</strong><span>{activeTask.reviewMode}</span></div>
        <div className="field-row"><strong>Tests</strong><span>{activeTask.testsPassed?'Passed':'Not passed'}</span></div>
        {activeTask.status!=='done'&&<><label>Verification evidence<input placeholder="Test command / evidence reference" value={proof} onChange={e=>setProof(e.target.value)}/></label>
         <button className="outline-button" onClick={()=>void doAction('task.tests',{id:activeTask.id,passed:true,evidence:proof})}>Record passing tests</button>
         <label>Workflow / review reason<input value={taskReason} onChange={e=>setTaskReason(e.target.value)} placeholder="Reason for override, review rejection, or Force Done"/></label>
         <div className="action-wrap">{activeTask.status==='ready-for-review'&&<>
          <button className="primary-button" onClick={()=>void doAction('task.review',{id:activeTask.id,verdict:'approve',reason:taskReason})}><Check size={14}/> Approve review</button>
          <button className="danger-outline" onClick={()=>void doAction('task.review',{id:activeTask.id,verdict:'reject',reason:taskReason})}><X size={14}/> Reject review</button></>}
          <button className="outline-button" onClick={()=>void doAction('task.transition',{id:activeTask.id,to:'done'})}>Move to Done</button>
          <button className="danger-outline" onClick={()=>void doAction('task.transition',{id:activeTask.id,to:'done',forceDone:true,reason:taskReason})}>Force Done (subtasks)</button>
         </div></>}
       </div>
       <div className="panel padded"><div className="mini-eyebrow">PREVIEW HANDOFF</div><h2>Linked previews</h2>
        {previews.filter(p=>p.taskId===activeTask.id).map(p=><button className="link-row" key={p.id} onClick={()=>choosePreview(p.id)}><Monitor size={15}/>{p.name}<ArrowRight size={14}/></button>)}
        {!previews.some(p=>p.taskId===activeTask.id)&&<p className="muted">No preview linked yet.</p>}
       </div>
      </section></div>}
     {tab==='checklist'&&<section className="panel padded"><div className="section-row"><div><div className="mini-eyebrow">LIGHTWEIGHT STEPS</div><h2>Checklist</h2></div>
      <Pill tone="blue">{activeTask.checklist.filter(c=>c.done).length} / {activeTask.checklist.length}</Pill></div>
      {activeTask.checklist.map((item,index)=><div className="checklist-row" key={item.id}><input aria-label={'Complete '+item.text} type="checkbox" checked={item.done} disabled={activeTask.status==='done'}
       onChange={e=>void doAction('task.checklist',{id:activeTask.id,action:'toggle',itemId:item.id,done:e.target.checked})}/>
       <span className={item.done?'crossed':''}>{item.text}</span>{activeTask.status!=='done'&&<>
       <button title="Move up" disabled={index===0||busy} onClick={()=>void doAction('task.checklist',{id:activeTask.id,action:'reorder',itemId:item.id,index:index-1})}><ArrowUp size={14}/></button>
       <button title="Move down" disabled={index===activeTask.checklist.length-1||busy} onClick={()=>void doAction('task.checklist',{id:activeTask.id,action:'reorder',itemId:item.id,index:index+1})}><ArrowDown size={14}/></button>
       <button title="Remove" onClick={()=>void doAction('task.checklist',{id:activeTask.id,action:'remove',itemId:item.id})}><X size={14}/></button></>}</div>)}
      {activeTask.status!=='done'&&<form className="row-form" onSubmit={e=>{e.preventDefault();void doAction('task.checklist',{id:activeTask.id,action:'add',text:checkText}).then(()=>setCheckText(''));}}>
       <input placeholder="Add checklist step" required value={checkText} onChange={e=>setCheckText(e.target.value)}/><button className="primary-button" disabled={busy}><Plus size={14}/> Add</button></form>}
     </section>}
     {tab==='subtasks'&&<section className="panel padded"><div className="mini-eyebrow">CHILD TASKS</div><h2>Subtasks</h2>
      {(detail?.children||[]).map(t=><button className="link-row" key={t.id} onClick={()=>chooseTask(t.id)}><span>{t.displayId}</span><strong>{t.title}</strong><Pill>{humanStatus(t.status)}</Pill><ArrowRight size={14}/></button>)}
      {!detail?.children.length&&<Empty title="No subtasks" body="Subtasks have independent workflow and completion gates."/>}
      {activeTask.status!=='done'&&!activeTask.parentId&&<form className="row-form" onSubmit={e=>{e.preventDefault();void doAction('task.subtask',{projectId,parentId:activeTask.id,title:taskTitle}).then(()=>setTaskTitle(''));}}>
       <input required placeholder="New subtask" value={taskTitle} onChange={e=>setTaskTitle(e.target.value)}/><button className="primary-button"><Plus size={15}/> Add</button></form>}
     </section>}
     {tab==='bugs'&&<section className="panel padded"><div className="mini-eyebrow">DEFECT TRACKING</div><h2>Bug threads</h2>
      {detail?.bugs.map(b=><div className="bug-entry" key={b.id}><header><Pill tone={b.status==='open'?'red':'green'}>{b.status}</Pill><strong>{b.title}</strong><span>{b.occurrences.length} findings</span></header>
       <p>{b.description}</p><small>Latest: {dateTime(b.updatedAt)}</small>
       {b.status==='open'&&activeTask.status!=='done'&&<button className="outline-button" onClick={()=>void doAction('task.bug.resolve',{id:b.id,reason:taskReason})}>Resolve with evidence</button>}</div>)}
      {!detail?.bugs.length&&<Empty title="No embedded bugs" body="Review rejection and explicit QA FAIL create linked findings."/>}
      {activeTask.status==='done'?<div className="post-done"><p>Completed tasks cannot be reopened. New defects become independent linked Bug tasks in Backlog.</p>
       <div className="row-form"><input placeholder="New post-Done defect" value={bugText} onChange={e=>setBugText(e.target.value)}/>
        <button className="primary-button" onClick={()=>void doAction('task.post-done-bug',{id:activeTask.id,title:bugText,description:taskReason})}>Create linked Bug</button></div>
       {detail?.linked.map(t=><button className="link-row" key={t.id} onClick={()=>chooseTask(t.id)}>{t.displayId} · {t.title}<ArrowRight size={14}/></button>)}</div>:
       <div className="row-form"><input placeholder="New bug finding" value={bugText} onChange={e=>setBugText(e.target.value)}/>
        <button className="outline-button" onClick={()=>void doAction('task.bug.create',{id:activeTask.id,origin:'manual',fingerprint:bugText,title:bugText,description:taskReason||bugText})}>Log bug</button></div>}
      <label>Reason / resolution evidence<input placeholder="Reason or verification evidence" value={taskReason} onChange={e=>setTaskReason(e.target.value)}/></label>
     </section>}
     {tab==='qa'&&<section className="panel padded"><div className="mini-eyebrow">VISUAL COMPARISON</div><h2>Current QA cases</h2>
      {taskCases.map(c=><CaseRow key={c.id} qa={c} evidence={snapshot?.screenshots.find(s=>s.id===c.evidenceId)}
       onInspect={()=>{setSelectedCase(c.id);setPage('preview');}}
       onUpload={e=>void uploadCase(e,c)} onRequired={required=>void doAction('qa.required',{id:c.id,required})}/>)}
      {!taskCases.length&&<Empty title="No QA cases" body="Approve a Preview with explicit screen/state/viewport tuples."/>}</section>}
     {tab==='history'&&<section className="panel padded"><div className="mini-eyebrow">IMMUTABLE EVENTS</div><h2>Task history</h2><ActivityList items={detail?.history||[]}/></section>}
    </>}</>}
    {page==='preview'&&<>
     <header className="page-heading"><div><div className="eyebrow">DESIGN TO QUALITY</div><h1>Preview &amp; Visual QA<span className="dot">.</span></h1><p>Editable interactive source, immutable approval and evidence-backed verdicts.</p></div></header>
     <div className="preview-selector"><select aria-label="Select Preview" value={selectedPreview} onChange={e=>choosePreview(e.target.value)}>
      <option value="">Choose a preview</option>{previews.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <input placeholder="New preview name" value={previewName} onChange={e=>setPreviewName(e.target.value)}/>
      <select aria-label="Link preview to task" value={previewTaskId} onChange={e=>setPreviewTaskId(e.target.value)}><option value="">Project-level (no task)</option>
       {tasks.filter(t=>t.status!=='done').map(t=><option key={t.id} value={t.id}>{t.displayId}: {t.title}</option>)}</select>
      <button className="primary-button" onClick={async()=>{const created=await doAction<Preview>('preview.create',{projectId,taskId:previewTaskId||undefined,name:previewName||'Untitled preview',
       html:'<main class="preview-stage"><h1>New screen</h1><button>Continue</button></main>',css:'body { font-family: system-ui; padding: 24px; }',js:'',screens:[defaultScreen()]});
       if(created){choosePreview(created.id);setPreviewName('');}}}><Plus size={15}/> New preview</button>
     </div>
     {activePreview&&draft?<><div className="context-banner"><div><strong>Project UI evidence</strong><span>{String(contextInfo?.currentContext.sufficiency||'Unavailable')} · {String(contextInfo?.currentContext.revision||contextInfo?.currentContext.contentHash||'No linked source hash').slice(0,32)}</span></div>
      <Pill tone={contextInfo?.changed?'amber':'green'}>{contextInfo?.changed?'Context changed':'Current snapshot'}</Pill>
      <button className="outline-button" onClick={()=>void doAction('preview.context.refresh',{id:activePreview.id}).then(()=>op<any>('preview.context',{id:activePreview.id}).then(setContextInfo))}>Refresh draft context</button>
     </div><div className="preview-tools">
      <div><strong>{activePreview.name}</strong><small>Draft · {activePreview.revisionIds.length} frozen revision(s)</small></div>
      <div className="action-wrap"><button className="outline-button" onClick={()=>void submitPreview()}><Save size={15}/> Save draft</button>
       <button className="primary-button" onClick={()=>void saveRevision()}><Clipboard size={15}/> Freeze revision</button></div>
     </div>
     <div className="preview-split">
      <section className="source-panel"><div className="source-toolbar"><strong>Source</strong><div className="source-tabs">
       {(['html','css','js'] as const).map(lang=><button key={lang} className={sourceTab===lang?'active':''} onClick={()=>setSourceTab(lang)}>{lang.toUpperCase()}</button>)}</div></div>
       <textarea spellCheck={false} aria-label={sourceTab.toUpperCase()+' source editor'} value={draft[sourceTab]}
        onChange={e=>setDraft({...draft,[sourceTab]:e.target.value})}/>
       <div className="source-foot">Preview runs in a sandboxed iframe. Save and Freeze to persist a revision.</div>
      </section>
      <section className="live-panel"><div className="source-toolbar"><strong><Eye size={15}/> Live Preview</strong>
       <select aria-label="Screen target" value={screenIndex} onChange={e=>setScreenIndex(Number(e.target.value))}>
        {screens.map((s,index)=><option key={index} value={index}>{s.name} · {s.stateId} · {s.viewport.device}</option>)}
       </select><div className="action-wrap"><button className="outline-button" title="Go back inside Preview" onClick={()=>previewFrame.current?.contentWindow?.postMessage({type:'flowly-preview-back'},'*')}><ArrowLeft size={14}/> Back</button>
        <button className="outline-button" title="Reset Preview state" onClick={()=>setPreviewResetKey(value=>value+1)}><RefreshCw size={14}/> Reset</button></div></div>
       <div className="preview-canvas"><iframe ref={previewFrame} key={previewResetKey} title="Sandboxed live interactive preview" sandbox="allow-scripts"
        style={{width:Math.min(screens[screenIndex]?.viewport.width||900,1100),height:Math.min(screens[screenIndex]?.viewport.height||650,700)}}
        srcDoc={'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; font-src data:; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>'+draft.css+'</style></head><body>'+draft.html+'<script>window.addEventListener("message",e=>{if(e.data?.type==="flowly-preview-back")history.back()});<\/script><script>'+draft.js+'<\/script></body></html>'}/></div>
       <div className="source-foot">No automatic approval. Selected target: {screens[screenIndex]?.viewport.width||'–'} × {screens[screenIndex]?.viewport.height||'–'}</div>
      </section>
     </div>
     <section className="panel padded screen-section"><div className="section-row"><div><div className="mini-eyebrow">QA MATRIX INPUT</div><h2>Explicit screen, state and viewport targets</h2></div>
      <button className="outline-button" onClick={()=>setDraft({...draft,screens:[...screens,defaultScreen()]})}><Plus size={14}/> Add target</button></div>
      {screens.map((s,index)=><div className="screen-config" key={index}>
       <label>Screen ID<input value={s.id} onChange={e=>updateScreen(index,{id:e.target.value})}/></label>
       <label>Name<input value={s.name} onChange={e=>updateScreen(index,{name:e.target.value})}/></label>
       <label>State<input value={s.stateId} onChange={e=>updateScreen(index,{stateId:e.target.value})}/></label>
       <label>Width<input type="number" value={s.viewport.width} onChange={e=>updateScreen(index,{viewport:{...s.viewport,width:Number(e.target.value)}})}/></label>
       <label>Height<input type="number" value={s.viewport.height} onChange={e=>updateScreen(index,{viewport:{...s.viewport,height:Number(e.target.value)}})}/></label>
       <label>Device<select value={s.viewport.device} onChange={e=>updateScreen(index,{viewport:{...s.viewport,device:e.target.value as ScreenSpec['viewport']['device']}})}>
        <option>desktop</option><option>tablet</option><option>mobile</option></select></label>
       <label className="inline-check"><input type="checkbox" checked={s.required!==false} onChange={e=>updateScreen(index,{required:e.target.checked})}/> Required</label>
       <button className="icon-button" aria-label="Remove target" onClick={()=>setDraft({...draft,screens:screens.filter((_,i)=>i!==index)})}><Trash2 size={15}/></button>
      </div>)}
     </section>
     <section className="panel padded"><div className="section-row"><div><div className="mini-eyebrow">APPROVAL CONTROL</div><h2>Immutable revision history</h2></div>
      <span className="muted">Current approved: {activePreview.approvedRevisionId?.slice(0,12)||'None'}</span></div>
      {activePreview.revisionIds.map((id,index)=><div className="link-row revision-row" key={id}><span>Rev {index+1}</span><code>{id.slice(0,13)}</code>
       {activePreview.approvedRevisionId===id?<Pill tone="green">Approved</Pill>:<button className="outline-button" onClick={()=>void approveRevision(id)}>Approve revision</button>}
       <button className="outline-button" onClick={async()=>{try{const result=await op<{passed:boolean;screens:Array<{screen:string;state:string;critical:number;warnings:number;issues:Array<{code:string;severity:string;message:string;selector?:string;suggestion?:string}>}>}>('preview.quality',{revisionId:id});setRenderQa({revisionId:id,...result});notify(result.passed?'No rendered QA issues':'Rendered QA findings available below');}catch(error){notify(String(error),true);}}}>Layout QA</button></div>)}
      {!activePreview.revisionIds.length&&<Empty title="No frozen revisions" body="Freeze the draft before explicit approval."/>}
      {renderQa&&activePreview.revisionIds.includes(renderQa.revisionId)&&<div className="render-qa-report"><strong>Rendered QA · {renderQa.passed?'Clear':'Action required'}</strong>
       {renderQa.screens.map(s=><div key={s.screen+'-'+s.state} className="render-qa-target"><span>{s.screen} · {s.state} · {s.critical} critical / {s.warnings} warnings</span>
        {s.issues.map((issue,index)=><p key={index}><Pill tone={issue.severity==='critical'?'red':'amber'}>{issue.severity}</Pill>
         <strong>{issue.code}</strong> {issue.message}{issue.suggestion&&<small>Suggested: {issue.suggestion}</small>}</p>)}</div>)}</div>}
      <label className="inline-check preview-warning-check"><input type="checkbox" checked={previewAcceptWarnings} onChange={e=>setPreviewAcceptWarnings(e.target.checked)}/> Explicitly accept nonblocking warnings (never critical defects)</label>
      {previewAcceptWarnings&&<label>Warning acceptance reason<input value={previewWarningReason} placeholder="Why is the warning intentional or acceptable?" onChange={e=>setPreviewWarningReason(e.target.value)}/></label>}
     </section>
     {project?.platform==='web'&&<section className="panel padded"><div className="mini-eyebrow">LOCAL WEB TARGET</div><h2>Browser Recorder and Replay</h2>
      <p className="muted">Record in a separate controlled browser. Profiles persist per Project, including cookies and localStorage.</p>
      <div className="action-wrap">
       <button className="outline-button" disabled={recording} onClick={()=>void recordAction('recorder.start',{projectId,screenId:screens[screenIndex]?.id||'',route:screens[screenIndex]?.route})}>Start recording</button>
       <button className="outline-button" disabled={!recording} onClick={()=>void recordAction('recorder.stop',{projectId})}>Stop & save</button>
       <button className="outline-button" onClick={()=>void recordAction('recorder.replay',{projectId,screenId:screens[screenIndex]?.id||'',route:screens[screenIndex]?.route})}>Replay steps</button>
       <button className="outline-button" disabled={!activePreview.taskId} onClick={()=>void recordAction('recorder.capture',{
        projectId,taskId:activePreview.taskId||'',screenId:screens[screenIndex]?.id||'',
        stateId:screens[screenIndex]?.stateId,route:screens[screenIndex]?.route,replay:true,
        caseId:cases.find(c=>c.previewId===activePreview.id&&c.screenId===screens[screenIndex]?.id&&c.stateId===screens[screenIndex]?.stateId)?.id
       })}>Auto Capture / Compare</button>
       <button className="danger-outline" onClick={()=>{if(window.confirm('Reset only this Project browser login session? Saved recipes and evidence remain.'))void recordAction('recorder.session.reset',{projectId,confirm:true});}}>Reset project session</button>
      </div>
      <div className="section-row recorder-steps"><strong>Recorded interaction steps</strong>
       <div className="action-wrap"><button className="outline-button" onClick={async()=>{try{
        const r=await op<{steps:unknown[]}>('recorder.steps',{projectId,screenId:screens[screenIndex]?.id});
        setRecipeText(JSON.stringify(r.steps,null,2));notify('Steps loaded');
       }catch(error){notify(String(error),true);}}}>Load steps</button>
       <button className="outline-button" onClick={()=>void doAction('recorder.steps.save',{
        projectId,screenId:screens[screenIndex]?.id,steps:safeJson(recipeText,'recorded steps')})}>Save ordered steps</button></div></div>
      <textarea rows={5} className="steps-editor" aria-label="Editable ordered browser steps JSON" spellCheck={false}
       value={recipeText} onChange={e=>setRecipeText(e.target.value)}/>
      </section>}
    </>:<Empty title="Select or create a preview" body="Start from an editable HTML/CSS/JS draft. No mock data is inserted into live QA."/>}
     <section className="panel padded"><div className="section-row"><div><div className="mini-eyebrow">FROZEN APPROVED BASELINE</div><h2>Visual QA cases</h2></div>
      <Pill tone="blue">{cases.length} cases</Pill></div>
      {cases.filter(c=>!selectedPreview||c.previewId===selectedPreview).map(c=><CaseRow key={c.id} qa={c} evidence={snapshot?.screenshots.find(s=>s.id===c.evidenceId)}
       onInspect={()=>setSelectedCase(c.id)} onUpload={e=>void uploadCase(e,c)}
       onRequired={required=>void doAction('qa.required',{id:c.id,required})}/>)}
      {!cases.length&&<Empty title="No active QA cases" body="Approve a Preview that is linked to a Task to generate required cases."/>}
     </section>
     {activeCase&&<section className="panel padded compare-section"><div className="section-row"><div><div className="mini-eyebrow">SCREENSHOT COMPARISON</div>
      <h2>{activeCase.screenId} · {activeCase.stateId}</h2><p className="muted">Original screenshot and frozen approved rendered baseline</p></div>
      <div className="segmented">{(['side','overlay','diff'] as const).map(mode=><button key={mode} className={compareMode===mode?'active':''} onClick={()=>setCompareMode(mode)}>{mode}</button>)}</div></div>
      {caseImage&&activeCase.comparisonId?<div className={'compare-images '+compareMode}>
       {compareMode==='diff'?<img src={diffUrl(caseImage.id)} alt="On-demand visual diff"/>:
        <><figure><img src={baselineUrl(activeCase.id)} alt="Approved preview baseline"/><figcaption>Approved reference</figcaption></figure>
         <figure><img src={fileUrl(caseImage.id)} alt="Captured implementation UI"/><figcaption>Captured evidence</figcaption></figure></>}</div>:
       <Empty title="Waiting for screenshot evidence" body="Upload a real image against this case or use agent CLI / Web Recorder."/>}
      <label>QA decision reason<input placeholder="Required for WAIVED; recommended for FAIL" value={qaReason} onChange={e=>setQaReason(e.target.value)}/></label>
      {activeCase.verdict==='WAIVED'&&<div className="good-note">Case is WAIVED for the current revision. New screenshots create a comparison awaiting review but do not cancel this waiver.</div>}
      {activeCase.history?.length? <details className="qa-history"><summary>Case history ({activeCase.history.length})</summary>
       {activeCase.history.slice().reverse().map((h,index)=><div key={index}>{dateTime(h.savedAt)} · {h.event} · {h.verdict||'PENDING'} · Revision {h.revisionId.slice(0,12)}</div>)}</details>:null}
      <div className="action-wrap"><button className="primary-button" disabled={busy||!caseImage} onClick={()=>void changeCase(activeCase.id,'PASS')}>Confirm PASS</button>
       <button className="danger-outline" disabled={busy||!caseImage} onClick={()=>void changeCase(activeCase.id,'FAIL')}>Confirm FAIL / Bug</button>
       <button className="outline-button" disabled={busy} onClick={()=>void changeCase(activeCase.id,'WAIVED')}>WAIVE with reason</button>
       {activeCase.verdict==='WAIVED'&&<button className="danger-outline" disabled={busy} onClick={()=>{if(window.confirm('Cancel the current QA waiver and restore PENDING?'))void doAction('qa.waiver.cancel',{id:activeCase.id,reason:qaReason});}}>Cancel WAIVED</button>}</div>
      <p className="muted">Comparison status: {activeCase.comparisonId?'Awaiting explicit confirmation or waived':'Needs evidence'}. No capture or comparison automatically grants PASS, FAIL, or approval.</p>
     </section>}
     <section className="panel padded"><div className="section-row"><div><div className="mini-eyebrow">UNASSIGNED EVIDENCE</div><h2>Screenshot Inbox</h2></div><Pill>{snapshot?.screenshots.filter(s=>!s.taskId).length||0}</Pill></div>
      {(snapshot?.screenshots||[]).filter(s=>s.source==='external'&&!s.taskId).map(s=><div className="inbox-row" key={s.id}><img src={fileUrl(s.id,true)} alt="Unassigned screenshot"/>
       <div><strong>{s.id.slice(0,18)}</strong><small>{s.source} · {dateTime(s.createdAt)} · {s.intake?.reason||'Unassigned'}</small><small>Requested: {s.intake?.requestedTaskId||'–'} / {s.intake?.requestedScreenId||'–'}</small></div>
       <select aria-label="Assign task" defaultValue="" id={'assign-'+s.id}><option value="">Choose task</option>
        {tasks.map(t=><option key={t.id} value={t.id}>{t.displayId}: {t.title}</option>)}</select>
       <input aria-label="Screen ID" placeholder="Screen ID" id={'screen-'+s.id}/>
       <button className="outline-button" onClick={()=>void doAction('screenshot.assign',{id:s.id,taskId:(document.getElementById('assign-'+s.id) as HTMLSelectElement).value,
        screenId:(document.getElementById('screen-'+s.id) as HTMLInputElement).value})}>Assign</button></div>)}
      {!snapshot?.screenshots.some(s=>s.source==='external'&&!s.taskId)&&<p className="muted">No external unassigned screenshots.</p>}
     </section>
    </>}
    {page==='settings'&&<><header className="page-heading"><div><div className="eyebrow">LOCAL CONFIGURATION</div><h1>Settings<span className="dot">.</span></h1><p>Project context, optional external intake and manual storage control.</p></div></header>
     <div className="detail-grid"><div className="detail-stack">
      <section className="panel padded"><div className="mini-eyebrow">PROJECT</div><h2>Target and UI context</h2>
       <label>Local Web target URL<input value={urlDraft} onChange={e=>setUrlDraft(e.target.value)} placeholder="http://127.0.0.1:3000"/></label>
       <label>Local project repository path<input value={sourcePathDraft} onChange={e=>setSourcePathDraft(e.target.value)} placeholder="C:\\Projects\\my-app"/></label>
      <label>Current UI design context (JSON)<textarea rows={7} spellCheck={false} value={contextDraft} onChange={e=>setContextDraft(e.target.value)}/></label>
       <button className="primary-button" onClick={()=>void doAction('project.update',{id:projectId,baseUrl:urlDraft,sourcePath:sourcePathDraft,uiContext:safeJson(contextDraft,'design context')})}><Save size={15}/> Save context</button>
       <p className="muted">Existing frozen revisions retain their original context snapshot.</p>
      </section>
      <section className="panel padded"><div className="mini-eyebrow">LOCAL API ACCESS</div><h2>External screenshot token</h2>
       <p className="muted">One installation-wide Access Token. Never rotated automatically. Authenticated localhost external ingress only.</p>
       <div className="token-line"><input aria-label="Access Token" readOnly type={token?'text':'password'} value={token||'********************************'}/>
        <button className="outline-button" onClick={async()=>{const response=await doAction<{token:string}>('settings.token.reveal');if(response)setToken(response.token);}}><Eye size={14}/> Reveal</button>
        <button className="outline-button" disabled={!token} onClick={()=>void navigator.clipboard.writeText(token).then(()=>notify('Token copied'))}><Clipboard size={14}/> Copy</button></div>
       <button className="danger-outline" onClick={()=>{if(window.confirm('Regenerate Access Token? All existing external clients must be reconfigured.'))void doAction<{token:string}>('settings.token.regenerate',{confirm:true}).then(result=>setToken(result?.token||''));}}>Regenerate (revoke old)</button>
      </section>
     </div>
     <section className="panel padded"><div className="mini-eyebrow">STORAGE</div><h2>Screenshot originals and thumbnails</h2>
      <div className="storage-stats"><div><strong>{amount(storage.bytes)}</strong><span>Total storage</span></div>
       <div><strong>{amount(storage.originals)}</strong><span>Originals</span></div>
       <div><strong>{amount(storage.thumbnails)}</strong><span>Thumbnails</span></div></div>
      <div className="action-wrap"><label className="inline-check"><input type="checkbox" checked={deletedShown} onChange={e=>setDeletedShown(e.target.checked)}/> Show Deleted History</label>
       <button className="outline-button" onClick={()=>void loadStorage()}><RefreshCw size={14}/> Recalculate</button>
       <button className="danger-outline" disabled={!selectedImages.length} onClick={()=>{if(window.confirm('Clean up selected unreferenced originals? QA/Bug-linked originals are protected.'))void doAction('screenshot.cleanup',{ids:selectedImages}).then(result=>{notify(JSON.stringify(result).slice(0,400));setSelectedImages([]);void loadStorage();});}}>Clean selected ({selectedImages.length})</button></div>
      {visibleScreenshots.map(s=><div className="screenshot-row" key={s.id}>
       {s.status==='deleted'?<Pill tone="red">Deleted</Pill>:<input aria-label={'Select image '+s.id} type="checkbox"
        checked={selectedImages.includes(s.id)} onChange={e=>setSelectedImages(e.target.checked?[...selectedImages,s.id]:selectedImages.filter(id=>id!==s.id))}/>}
       {s.status==='deleted'?<span className="deleted-thumbnail">No image</span>:<img src={fileUrl(s.id,true)} alt="Screenshot thumbnail"/>}
       <span><strong>{s.id.slice(0,23)}</strong><small>{s.source} · {s.sourceId||'No source ID'} · {s.captureId||'No capture ID'} · {dateTime(s.deletedAt||s.createdAt)}</small></span>
       <strong>{s.status==='deleted'?'Tombstone':amount(s.bytes)}</strong>
      </div>)}
      {deletedShown&&<div className="deleted-note">Deleted receipts retain ID and timestamp but have no openable image or Restore action. Protected images cannot be deleted.</div>}
     </section></div></>}
   </main>
  </div>
  {showCreateProject&&<div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
   <form className="modal panel" onSubmit={createProject}><div className="mini-eyebrow">FIRST WORKSPACE</div><h2 id="project-modal-title">Create a local project</h2>
    <p>Flowly runs locally and requires no external account.</p>
    <label>Project name<input autoFocus required value={projectName} onChange={e=>setProjectName(e.target.value)}/></label>
    <label>Target platform<select value={projectPlatform} onChange={e=>setProjectPlatform(e.target.value as typeof projectPlatform)}>
     <option value="web">Web</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
    {projectPlatform==='web'&&<label>Local target URL (optional)<input placeholder="http://127.0.0.1:3000" value={projectUrl} onChange={e=>setProjectUrl(e.target.value)}/></label>}
    <button className="primary-button" disabled={busy}>Create project</button></form>
   </div>}
 </div>;
 function updateScreen(index:number,patch:Partial<ScreenSpec>){
  if(!draft)return;
  setDraft({...draft,screens:draft.screens.map((s,i)=>i===index?{...s,...patch}:s)});
 }
}
function ActivityList({items}:{items:Array<{id:string;action:string;actor:string;channel:string;at:string;taskId?:string;from?:string;to?:string}>}){
 if(!items.length)return <Empty title="No activity recorded" body="Task changes made by CLI or Web appear here."/>;
 return <div className="activity-list">{items.map(item=><div className="activity-row" key={item.id}>
  <span className="activity-icon"><Activity size={15}/></span>
  <div><strong>{humanStatus(item.action.replaceAll('.',' '))}</strong><small>{item.actor} · {item.channel}
   {item.from&&item.to&&' · '+humanStatus(item.from)+' → '+humanStatus(item.to)}</small></div><Stamp value={item.at}/>
 </div>)}</div>;
}
function CaseRow({qa,evidence,onInspect,onUpload,onRequired}:{qa:QaCase;evidence?:Screenshot;onInspect:()=>void;
 onUpload:(e:ChangeEvent<HTMLInputElement>)=>void;onRequired:(required:boolean)=>void}){
 return <div className="qa-case-row"><span className={'qa-dot q-'+(qa.verdict||'pending').toLowerCase()}/>
  <button className="qa-case-title" onClick={onInspect}><strong>{qa.screenId} / {qa.stateId}</strong><small>{qa.viewport.width} × {qa.viewport.height} · {qa.viewport.device}</small></button>
  <Pill tone={qa.verdict==='PASS'?'green':qa.verdict==='FAIL'?'red':qa.verdict==='WAIVED'?'amber':'neutral'}>{qa.verdict||'Awaiting verdict'}</Pill>
  <label className="inline-check"><input type="checkbox" checked={qa.required} onChange={e=>onRequired(e.target.checked)}/> Required</label>
  <label className="outline-button upload-btn"><Upload size={13}/> Upload<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload}/></label>
  <button className="icon-button" title="Inspect" onClick={onInspect}><ArrowRight size={15}/></button>
 </div>;
}
