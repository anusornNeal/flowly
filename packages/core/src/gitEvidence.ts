import { execFileSync } from 'node:child_process';
import type { LocalStore } from '../../db/src/store.js';
import type { Project, TaskRecord } from './models.js';
import { DomainError } from './models.js';

// Local-server-only Git evidence importer. Does not invent technical explanations.
export function inspectGitCommit(store:LocalStore,id:string,commit:string){
 const task=store.get<TaskRecord>('task',id);
 if(!task)throw new DomainError('NOT_FOUND','Task not found',404);
 if(!/^[0-9a-f]{7,40}$/i.test(commit))throw new DomainError('INVALID_COMMIT','Git commit hash required');
 const project=store.get<Project>('project',task.projectId);
 if(!project?.sourcePath)throw new DomainError('SOURCE_PATH_REQUIRED','Configure the project sourcePath first');
 let output:string;
 try{output=execFileSync('git',['-C',project.sourcePath,'show','--format=%s','--name-status','--no-renames',commit],
  {encoding:'utf8',timeout:8000,maxBuffer:1048576});}
 catch{throw new DomainError('GIT_COMMIT_UNAVAILABLE','Could not read this commit from the configured repository');}
 const lines=output.split(/\r?\n/).filter(Boolean);
 const subject=lines.shift()||'';
 const changes=lines.flatMap(line=>{
  const parts=line.split('\t');
  if(parts.length<2)return [];
  const status=parts[0]?.charAt(0)||'?';
  const path=parts.at(-1)||'';
  return path?[{path,summary:({A:'Added',M:'Modified',D:'Deleted',R:'Renamed'} as Record<string,string>)[status]||'Changed'}]:[];
 });
 return {commit,subject,changes,verified:true,
  note:'Git-derived file changes only. Agent must explain actual behavior and verify tests separately.'};
}
