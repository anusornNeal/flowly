import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../apps/api/src/server.js';

test('Thai text is preserved across task create, update and persistence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-thai-'));
 let app=await createServer({root});
 const headers={host:'127.0.0.1:3210','content-type':'application/json; charset=utf-8'};
 const op=(name:string,body:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/operations/'+name,headers,payload:JSON.stringify(body)});
 try {
  const proj=await op('project.create',{name:'ทดสอบภาษาไทย'});
  assert.equal(proj.statusCode,200);
  const projectId=proj.json().result.id as string;
  const original='การ์ดทดสอบจาก ChatGPT';
  const created=await op('task.create',{projectId,title:original,description:'ตรวจการแสดงผลภาษาไทยบน Task Board'});
  assert.equal(created.statusCode,200);
  const task=created.json().result;
  assert.equal(task.title,original);
  assert.equal(task.description,'ตรวจการแสดงผลภาษาไทยบน Task Board');
  const updated=await op('task.update',{id:task.id,title:'แก้ไขรายละเอียดภาษาไทย',description:'ข้อความใหม่ที่มีวรรณยุกต์ ถูกต้อง'});
  assert.equal(updated.statusCode,200,updated.body);
  assert.equal(updated.json().result.description,'ข้อความใหม่ที่มีวรรณยุกต์ ถูกต้อง');
  await app.close();
  app=await createServer({root});
  const listed=await op('task.list',{projectId});
  assert.equal(listed.statusCode,200);
  assert.equal(listed.json().result[0].title,'แก้ไขรายละเอียดภาษาไทย');
  assert.equal(listed.json().result[0].description,'ข้อความใหม่ที่มีวรรณยุกต์ ถูกต้อง');
 } finally {
  await app.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
