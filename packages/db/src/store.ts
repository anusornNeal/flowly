import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { records, settings, auditLog } from './schema.js';
import type { Activity, BugThread, Comparison, Preview, PreviewRevision, Project, QaCase, Screenshot, TaskRecord, JobRecord } from '../../core/src/models.js';

export type Kind = 'project' | 'task' | 'bug' | 'preview' | 'revision' | 'qa' | 'screenshot' | 'comparison' | 'recipe' | 'job';
export type Entity = Project | TaskRecord | BugThread | Preview | PreviewRevision | QaCase | Screenshot | Comparison | JobRecord | { id: string; projectId: string; screenId: string; steps: unknown[] };
type DataRecord = Entity & { id: string; projectId?: string; taskId?: string; status?: string; updatedAt?: string };
export class LocalStore {
 readonly root: string;
 private raw: Database.Database;
 private orm;
 constructor(root = process.env.FLOWLY_DATA_DIR || path.join(os.homedir(), '.flowly')) {
  this.root = path.resolve(root);
  fs.mkdirSync(this.root, { recursive: true });
  this.raw = new Database(path.join(this.root,'flowly.db'));
  this.raw.pragma('journal_mode = WAL');
  this.raw.pragma('foreign_keys = ON');
  this.raw.pragma('busy_timeout = 5000');
  this.raw.exec([
   'CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,task_id TEXT,status TEXT,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id))',
   'CREATE INDEX IF NOT EXISTS idx_records_project ON records(kind,project_id)',
   'CREATE INDEX IF NOT EXISTS idx_records_task ON records(kind,task_id)',
   'CREATE INDEX IF NOT EXISTS idx_records_status ON records(kind,status)',
   'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
   'CREATE TABLE IF NOT EXISTS capture_keys(source_id TEXT NOT NULL,capture_id TEXT NOT NULL,screenshot_id TEXT NOT NULL,PRIMARY KEY(source_id,capture_id))',
   'CREATE TABLE IF NOT EXISTS operation_replays(project_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(project_id,idempotency_key))',
   'CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,channel TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL)',
   'CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id)',
   'CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_log(task_id)'
  ].join(';')+';');
  this.orm = drizzle(this.raw);
 }
 close() { this.raw.close(); }
 transaction<T>(fn: () => T): T { return this.raw.transaction(fn)(); }
 // Uses the exact domain mutation and SQLite SAVEPOINTs but always rolls back all
 // records, audit and idempotency entries. Only call for DB-only commands.
 dryRun<T>(fn:()=>T):T {
  class Rollback extends Error { constructor(public readonly result:T){super('dry-run rollback');} }
  try{this.raw.transaction(()=>{throw new Rollback(fn());})();}catch(error){
   if(error instanceof Rollback)return error.result;
   throw error;
  }
  throw Error('Dry-run transaction did not roll back');
 }
 get<T extends Entity>(kind: Kind, id: string): T | undefined {
  const [found] = this.orm.select().from(records).where(and(eq(records.kind,kind), eq(records.id,id))).limit(1).all();
  return found ? JSON.parse(found.body) as T : undefined;
 }
 list<T extends Entity>(kind: Kind, filter?: { projectId?: string; taskId?: string; status?: string }): T[] {
  const conditions = [eq(records.kind,kind)];
  if (filter?.projectId) conditions.push(eq(records.projectId,filter.projectId));
  if (filter?.taskId) conditions.push(eq(records.taskId,filter.taskId));
  if (filter?.status) conditions.push(eq(records.status,filter.status));
  return this.orm.select().from(records).where(and(...conditions)).orderBy(desc(records.updatedAt)).all().map(v => JSON.parse(v.body) as T);
 }
 put<T extends DataRecord>(kind: Kind, record: T): T {
  const row = { kind, id:record.id, projectId:record.projectId ?? null, taskId:record.taskId ?? null,
   status:record.status ?? null, body:JSON.stringify(record), updatedAt:record.updatedAt || new Date().toISOString() };
  this.orm.insert(records).values(row).onConflictDoUpdate({ target:[records.kind,records.id],set:{
   body:row.body,projectId:row.projectId,taskId:row.taskId,status:row.status,updatedAt:row.updatedAt
  }}).run();
  return record;
 }
 remove(kind: Kind, id: string): void {
  this.orm.delete(records).where(and(eq(records.kind,kind),eq(records.id,id))).run();
 }
 replayOperation(projectId:string,key:string):{requestHash:string;result:unknown}|undefined {
  const found=this.raw.prepare('SELECT request_hash AS requestHash,response FROM operation_replays WHERE project_id=? AND idempotency_key=?').get(projectId,key) as {requestHash:string;response:string}|undefined;
  return found?{requestHash:found.requestHash,result:JSON.parse(found.response)}:undefined;
 }
 saveOperationReplay(projectId:string,key:string,requestHash:string,result:unknown){
  this.raw.prepare('INSERT INTO operation_replays(project_id,idempotency_key,request_hash,response) VALUES(?,?,?,?)').run(projectId,key,requestHash,JSON.stringify(result));
 }
 captureKey(sourceId:string,captureId:string):string|undefined {
  const row=this.raw.prepare('SELECT screenshot_id AS id FROM capture_keys WHERE source_id=? AND capture_id=?').get(sourceId,captureId) as {id:string}|undefined;
  return row?.id;
 }
 claimCaptureKey(sourceId:string,captureId:string,screenshotId:string):{claimed:boolean;id:string} {
  this.raw.prepare('INSERT OR IGNORE INTO capture_keys(source_id,capture_id,screenshot_id) VALUES(?,?,?)').run(sourceId,captureId,screenshotId);
  const id=this.captureKey(sourceId,captureId);
  if(!id)throw Error('Capture reservation unavailable');
  return {claimed:id===screenshotId,id};
 }
 setting(key: string): string | undefined {
  return this.orm.select().from(settings).where(eq(settings.key,key)).get()?.value;
 }
 setSetting(key: string, value: string): void {
  this.orm.insert(settings).values({key,value}).onConflictDoUpdate({target:settings.key,set:{value}}).run();
 }
 nextSequence(key: string): number {
  return this.transaction(()=>{
   const prev=Number(this.setting('sequence:'+key) || '0');
   this.setSetting('sequence:'+key,String(prev+1)); return prev+1;
  });
 }
 audit(input: Omit<Activity,'id'|'at'> & {at?:string}): Activity {
  const entry:Activity={id:'evt_'+randomUUID(), at:input.at || new Date().toISOString(),...input};
  this.orm.insert(auditLog).values({id:entry.id,projectId:entry.projectId,taskId:entry.taskId ?? null,
   action:entry.action,actor:entry.actor,channel:entry.channel,at:entry.at,body:JSON.stringify(entry)}).run();
  return entry;
 }
 protectedEvidenceReferences(evidenceId:string):string[] {
  const matches=this.raw.prepare("SELECT action,body FROM audit_log WHERE action IN ('qa.verdict','bug.create','bug.reopen') AND json_extract(body,'$.evidence.evidenceId') = ?").all(evidenceId) as Array<{action:string;body:string}>;
  return matches.filter(row=>{
   const item=JSON.parse(row.body) as Activity;
   return row.action!=='qa.verdict'||['PASS','FAIL'].includes(String(item.evidence?.verdict));
  }).map(row=>{
   const item=JSON.parse(row.body) as Activity;
   return row.action==='qa.verdict'?'Historical QA '+String(item.evidence?.caseId)+' '+String(item.evidence?.verdict):'Historical Bug '+String(item.evidence?.bugId);
  });
 }
 history(projectId:string, taskId?:string, limit=150): Activity[] {
  const cond=[eq(auditLog.projectId,projectId)];
  if(taskId) cond.push(eq(auditLog.taskId,taskId));
  return this.orm.select().from(auditLog).where(and(...cond)).orderBy(desc(auditLog.at)).limit(limit).all()
   .map(row=>JSON.parse(row.body) as Activity);
 }
}
