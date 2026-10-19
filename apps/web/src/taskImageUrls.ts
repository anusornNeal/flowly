import type { TaskAttachmentDto } from '../../../packages/core/src/models.js';

const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Only canonical API images; callers also check current task membership. */
export function taskImageUrl(source?:string,origin=typeof window==='undefined'?'http://localhost':window.location.origin):string|undefined{
 if(!source||/[\\\s\u0000-\u001f]/.test(source))return;
 try{
  const url=new URL(source,origin);
  if(url.origin!==origin||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)return;
  if(!new RegExp('^/api/task-attachments/att_'+uuid+'/(file|thumbnail)$','i').test(url.pathname))return;
  if([...url.searchParams].length!==1||!new RegExp('^proj_'+uuid+'$','i').test(url.searchParams.get('projectId')||''))return;
  return url.pathname+url.search;
 }catch{return;}
}
export function referencedTaskImage(source:string|undefined,attachments:readonly TaskAttachmentDto[]){
 const url=taskImageUrl(source);
 return url?attachments.find(item=>!item.deletedAt&&(url===taskImageUrl(item.fileUrl)||url===taskImageUrl(item.thumbnailUrl))):undefined;
}
export function attachmentMarkdown(attachment:TaskAttachmentDto){
 const alt=(attachment.altText||attachment.name).replace(/[\\\[\]<>\r\n]/g,' ');
 return `![${alt}](<${attachment.fileUrl}>)`;
}
