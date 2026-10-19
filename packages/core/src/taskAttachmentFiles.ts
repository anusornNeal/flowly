import fs from 'node:fs';
import path from 'node:path';
import { DomainError } from './models.js';
import { TASK_ATTACHMENT_LIMITS, type AttachmentFileInput, type AttachmentImage } from './taskAttachments.js';

// Trusted local CLI transport only. HTTP never accepts filesystem paths.
export function readAttachmentFiles(value:unknown):AttachmentImage[] {
 if(!Array.isArray(value)||!value.length)throw new DomainError('IMAGE_REQUIRED','files must contain local image paths or file objects');
 if(value.length>TASK_ATTACHMENT_LIMITS.maxFiles)throw new DomainError('ATTACHMENT_LIMIT','At most 10 images per task',409);
 return value.map((item:unknown)=>{
  const file=(typeof item==='string'?{path:item}:item) as AttachmentFileInput;
  if(!file||typeof file.path!=='string'||!file.path||Object.keys(file).some(key=>!['path','name','mime','altText'].includes(key)))
   throw new DomainError('INVALID_ATTACHMENT_INPUT','Each file needs a local path and optional name, mime, altText');
  let descriptor:number|undefined;
  try {
   descriptor=fs.openSync(file.path,'r');
   const stat=fs.fstatSync(descriptor);
   if(!stat.isFile())throw new DomainError('ATTACHMENT_FILE_UNREADABLE','Attachment path must be a regular local file');
   if(stat.size>TASK_ATTACHMENT_LIMITS.maxBytes)throw new DomainError('IMAGE_TOO_LARGE','Image exceeds 25 MiB',413);
   // Bounded even if another process grows the file after fstat.
   const buffer=Buffer.alloc(Math.min(stat.size+1,TASK_ATTACHMENT_LIMITS.maxBytes+1));
   let length=0,read=0;
   do {read=fs.readSync(descriptor,buffer,length,buffer.length-length,null);length+=read;}while(read&&length<buffer.length);
   if(length>stat.size)throw new DomainError('ATTACHMENT_FILE_CHANGED','File changed while reading; retry',409);
   return {data:buffer.subarray(0,length),name:file.name??path.basename(file.path),mime:file.mime,altText:file.altText};
  }catch(error){
   if(error instanceof DomainError)throw error;
   throw new DomainError('ATTACHMENT_FILE_UNREADABLE','Could not read local attachment file',400);
  }finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
 });
}
