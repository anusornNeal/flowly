import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Project } from './models.js';
const MAX_FILES=25,MAX_SOURCE_BYTES=32768;
const IGNORE=new Set(['.git','.next','node_modules','dist','build','coverage','out','.cache','target','.gradle','vendor']);
const allowedExt=new Set(['.css','.scss','.sass','.less','.tsx','.jsx','.html']);
function boundedFiles(root:string){
 const items:Array<{relative:string;body:string}>=[];
 const walk=(dir:string,depth:number)=>{
  if(depth>4||items.length>=MAX_FILES)return;
  let entries:fs.Dirent[];
  try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
   if(items.length>=MAX_FILES)break;
   if(entry.isSymbolicLink()||entry.name.startsWith('.')||IGNORE.has(entry.name))continue;
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){walk(full,depth+1);continue;}
   if(!entry.isFile()||!allowedExt.has(path.extname(entry.name).toLowerCase()))continue;
   const stat=fs.statSync(full);
   if(stat.size>MAX_SOURCE_BYTES)continue;
   try{items.push({relative:path.relative(root,full).replaceAll('\\','/'),body:fs.readFileSync(full,'utf8')});}
   catch{}
  }
 };
 walk(root,0);return items;
}
function repoRevision(root:string):string|null{
 try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,timeout:1400,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim()||null;}
 catch{return null;}
}
export function inspectLocalUIContext(project:Project):Record<string,unknown>{
 const capturedAt=new Date().toISOString(),manual=structuredClone(project.uiContext||{});
 const root=project.sourcePath&&path.resolve(project.sourcePath);
 if(!root||!fs.existsSync(root)||!fs.statSync(root).isDirectory()){
  return {capturedAt,kind:'manual-baseline',sourcePath:project.sourcePath||null,revision:null,contentHash:null,
   files:[],colors:[],fonts:[],manual,sufficiency:'unavailable',
   uncertainty:root?'Configured repository directory is unavailable':'Project repository directory not configured: exact UI fidelity is unverified'};
 }
 const files=boundedFiles(root);
 const colors=new Set<string>(),fonts=new Set<string>();
 const sha=createHash('sha256');
 for(const f of files){
  sha.update(f.relative+'\0'+f.body+'\0');
  for(const token of f.body.match(/#[0-9A-Fa-f]{6}(?![0-9A-Fa-f])|#[0-9A-Fa-f]{3}(?![0-9A-Fa-f])/g)||[]){
   if(colors.size>=48)break;colors.add(token.toLowerCase());
  }
  const families=[...f.body.matchAll(/font-family\s*:\s*([^;\n}\r]+)/ig)];
  for(const match of families){if(fonts.size<18)fonts.add((match[1]||'').trim().slice(0,110));}
 }
 const enough=files.some(f=>/\.(css|scss|sass|less)$/.test(f.relative))&&files.some(f=>/\.(tsx|jsx|html)$/.test(f.relative));
 return {capturedAt,kind:'local-repository',sourcePath:root,revision:repoRevision(root),
  contentHash:files.length?sha.digest('hex'):null,files:files.map(f=>f.relative),colors:[...colors],fonts:[...fonts],manual,
  sufficiency:enough?'strong':files.length?'partial':'unavailable',
  uncertainty:enough?null:'Bounded local UI evidence is incomplete; visual fidelity cannot be guaranteed'};
}
