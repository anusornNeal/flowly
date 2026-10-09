import { DomainError } from './models.js';
import { DRY_RUN_OPERATIONS } from './dryRun.js';

type Param={type:'string'|'number'|'boolean'|'object'|'array';required?:boolean;enum?:string[];description?:string};
export type OperationContract={operation:string;parameters:Record<string,Param>;readOnly:boolean;dryRun:boolean;transport:'local'|'persistent-api';notes?:string};

const param=(type:Param['type']='string'):Param=>({type});
const id=param(),projectId=param(),taskId=param(),previewId=param();
const FIELDS:Record<string,Record<string,Param>>={
 'project.create':{name:param(),platform:{type:'string',enum:['web','desktop','mobile']},baseUrl:param(),sourcePath:param(),uiContext:param('object')},
 'project.update':{id, name:param(),platform:param(),baseUrl:param(),sourcePath:param(),uiContext:param('object')},
 'project.get':{id},
 'task.list':{projectId},'task.create':{projectId,title:param(),description:param(),risk:param('object'),reviewMode:param()},
 'task.subtask':{projectId,parentId:param(),title:param()},'task.get':{id},'task.detail':{id},
 'task.context':{id},'task.update':{id,title:param(),description:param(),risk:param('object'),priority:param(),reviewSkipReason:param()},
 'task.transition':{id,to:{type:'string',enum:['backlog','todo','in-progress','ready-for-review','done']},reason:param(),forceDone:param('boolean')},
 'task.tests':{id,passed:param('boolean'),evidence:param()},
 'task.checklist':{id,action:{type:'string',enum:['add','edit','toggle','remove','reorder']},itemId:param(),text:param(),done:param('boolean'),index:param('number')},
 'task.batch':{projectId,idempotencyKey:param(),operations:param('array')},
 'task.review':{id,verdict:{type:'string',enum:['approve','reject']},reason:param(),fingerprint:param(),evidenceId:param()},
 'task.bugs':{id},'task.bug.create':{id,origin:{type:'string',enum:['review','visual_qa','manual']},fingerprint:param(),title:param(),description:param()},
 'task.bug.resolve':{id,reason:param()},
 'task.post-done-bug':{id,title:param(),description:param()},
 'task.history':{projectId,id},'task.blockers':{id},
 'preview.list':{projectId},'preview.create':{projectId,taskId,name:param(),html:param(),css:param(),js:param(),screens:param('array')},
 'preview.get':{id},'preview.draft':{id,html:param(),css:param(),js:param(),screens:param('array')},
 'preview.context':{id},'preview.context.refresh':{id},
 'preview.revision.save':{id},'preview.revision.get':{id},
 'preview.approve':{id,revisionId:param(),acceptWarnings:param('boolean'),warningReason:param()},
 'preview.quality':{revisionId:param(),screenId:param(),projectId}, 
 'qa.list':{projectId,taskId,previewId,allRevisions:param('boolean')},
 'qa.get':{id},'qa.required':{id,required:param('boolean')},
 'qa.verdict':{id,verdict:{type:'string',enum:['PASS','FAIL','WAIVED']},reason:param()},
 'qa.waiver.cancel':{id,reason:param()},
 'screenshot.list':{projectId,includeDeleted:param('boolean')},
 'screenshot.inbox':{projectId},'screenshot.get':{id},'screenshot.assign':{id,taskId,screenId:param(),stateId:param(),caseId:param()},
 'screenshot.compare':{id,projectId},'screenshot.cleanup':{ids:param('array')}, 
 'screenshot.storage':{},'screenshot.ingest-file':{path:param(),projectId,taskId,screenId:param(),stateId:param(),caseId:param()},
 'recorder.start':{projectId,screenId:param(),route:param()},
 'recorder.stop':{projectId},'recorder.steps':{projectId,screenId:param()},
 'recorder.steps.save':{projectId,screenId:param(),steps:param('array')},
 'recorder.replay':{projectId,screenId:param(),route:param()},
 'recorder.capture':{projectId,taskId,screenId:param(),route:param(),stateId:param(),caseId:param(),replay:param('boolean')},
 'recorder.session.reset':{projectId,confirm:param('boolean')},
 'settings.token.reveal':{},'settings.token.regenerate':{confirm:param('boolean')},
 'activity':{projectId,taskId},'snapshot':{projectId},
 'job.start':{projectId,operation:param(),idempotencyKey:param(),input:param('object'),payload:param('object')},'job.status':{id},'job.list':{projectId,offset:param('number'),limit:param('number')},'job.retry':{id},'job.cancel':{id}
};
const REQUIRED:Record<string,string[]>={
 'project.create':['name'],'project.update':['id'],'project.get':['id'],
 'task.list':['projectId'],'task.create':['projectId','title'],'task.subtask':['projectId','parentId','title'],
 'task.get':['id'],'task.detail':['id'],'task.context':['id'],'task.update':['id'],'task.transition':['id','to'],
 'task.tests':['id','passed'],'task.checklist':['id','action'],'task.batch':['projectId','operations'],
 'task.review':['id','verdict'],'task.bugs':['id'],'task.bug.create':['id','origin','fingerprint','title','description'],
 'task.bug.resolve':['id','reason'],'task.post-done-bug':['id','title','description'],
 'task.history':['projectId'],'task.blockers':['id'],
 'preview.list':['projectId'],'preview.create':['projectId','name'],'preview.get':['id'],'preview.draft':['id'],
 'preview.context':['id'],'preview.context.refresh':['id'],'preview.revision.save':['id'],
 'preview.revision.get':['id'],'preview.approve':['id','revisionId'],'preview.quality':['revisionId'],
 'qa.get':['id'],'qa.required':['id','required'],'qa.verdict':['id','verdict'],'qa.waiver.cancel':['id'],
 'screenshot.get':['id'],'screenshot.assign':['id','taskId','screenId'],'screenshot.compare':['id'],
 'screenshot.cleanup':['ids'],'screenshot.ingest-file':['path'],'recorder.start':['projectId','screenId'],
 'recorder.stop':['projectId'],'recorder.steps':['projectId'],'recorder.steps.save':['projectId','screenId','steps'],
 'recorder.replay':['projectId','screenId'],'recorder.capture':['projectId','taskId','screenId'],
 'recorder.session.reset':['projectId','confirm'],'settings.token.regenerate':['confirm'],
 'activity':['projectId'],'snapshot':['projectId'],'job.start':['projectId','operation'],'job.status':['id'],'job.list':['projectId'],'job.retry':['id'],'job.cancel':['id']
};
const READ_ONLY=new Set('project.list project.get task.list task.get task.detail task.context task.bugs task.history task.blockers preview.list preview.get preview.context preview.revision.get preview.quality qa.list qa.get screenshot.list screenshot.inbox screenshot.get screenshot.compare screenshot.storage recorder.steps activity snapshot job.status job.list'.split(' '));
const PERSISTENT=new Set('recorder.start recorder.stop recorder.replay recorder.capture recorder.session.reset job.start job.status job.list job.retry job.cancel'.split(' '));
export function describeOperation(operation:string):OperationContract {
 if(!Object.hasOwn(FIELDS,operation))throw new DomainError('UNKNOWN_OPERATION','Unknown Flowly operation',404);
 const required=new Set(REQUIRED[operation]||[]);
 return {operation,parameters:Object.fromEntries(Object.entries(FIELDS[operation]!).map(([name,v])=>[name,{...v,required:required.has(name)}])),
  readOnly:READ_ONLY.has(operation),dryRun:(DRY_RUN_OPERATIONS as readonly string[]).includes(operation),
  transport:PERSISTENT.has(operation)?'persistent-api':'local'};
}
export function allContracts(){return Object.keys(FIELDS).map(describeOperation);}
