import type { Activity, BugThread, Preview, Project, QaCase, Screenshot, TaskRecord } from '../../../packages/core/src/models.js';

export type Snapshot={
 project:Project;tasks:TaskRecord[];previews:Preview[];cases:QaCase[];
 screenshots:Screenshot[];bugs:BugThread[];activity:Activity[];
};
export type Detail={task:TaskRecord;children:TaskRecord[];bugs:BugThread[];cases:QaCase[];
 linked:TaskRecord[];blockers:string[];risk:string;history:Activity[]};
export async function get<T>(route:string):Promise<T>{
 const response=await fetch('/api/'+route,{cache:'no-store'});
 const body=await response.json();
 if(!response.ok||!body.ok)throw new Error(body.message||body.code||'Flowly request failed');
 return body.result as T;
}
export async function op<T>(name:string,input:Record<string,unknown>={}):Promise<T>{
 const response=await fetch('/api/operations/'+encodeURIComponent(name),{
  method:'POST',headers:{'Content-Type':'application/json','X-Flowly-Actor':'local-user'},
  body:JSON.stringify(input)
 });
 const body=await response.json();
 if(!response.ok||!body.ok){
  const details=body.details?.blockers;
  throw new Error((body.message||body.code||'Request failed')+(Array.isArray(details)?': '+details.join(', '):''));
 }
 return body.result as T;
}
export async function upload(file:File,input:Record<string,string>):Promise<unknown>{
 const form=new FormData();form.append('file',file);
 Object.entries(input).forEach(([key,value])=>{if(value)form.append(key,value);});
 const response=await fetch('/api/screenshots/manual',{method:'POST',body:form});
 const body=await response.json();
 if(!response.ok||!body.ok)throw new Error(body.message||'Screenshot upload failed');
 return body.result;
}
export const fileUrl=(id:string,thumb=false)=>'/api/screenshots/'+encodeURIComponent(id)+'/file'+(thumb?'?thumbnail=true':'');
export const baselineUrl=(id:string)=>'/api/qa/'+encodeURIComponent(id)+'/baseline';
export const diffUrl=(id:string)=>'/api/screenshots/'+encodeURIComponent(id)+'/diff';
export function dateLabel(value?:string){
 if(!value)return '-';
 return new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
}
