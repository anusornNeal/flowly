import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';
const host={host:'127.0.0.1:3210'};
async function tokenOf(api:Awaited<ReturnType<typeof createServer>>){
 const res=await api.inject({method:'POST',url:'/api/operations/settings.token.reveal',headers:{...host,'content-type':'application/json'},payload:{}});
 assert.equal(res.statusCode,200);return res.json().result.token as string;
}
test('external token survives restart, rejects unauthenticated capture before reserving ID',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-ingress-restart-'));
 let api=await createServer({root});
 try{
  const token=await tokenOf(api);
  const project=await api.inject({method:'POST',url:'/api/operations/project.create',headers:{...host,'content-type':'application/json'},payload:{name:'Restart check',platform:'desktop'}});
  assert.equal(project.statusCode,200);
  const projectId=project.json().result.id as string;
  await api.close();api=await createServer({root});
  assert.equal(await tokenOf(api),token,'restart cannot silently rotate token');
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
  const boundary='FLOWLY_BOUNDARY';
  const fields={projectId,sourceId:'sender',captureId:'capture-once'};
  const parts:Buffer[]=Object.entries(fields).map(([key,value])=>Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+value+'\r\n'));
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="actual.png"\r\nContent-Type: image/png\r\n\r\n'));
  parts.push(png,Buffer.from('\r\n--'+boundary+'--\r\n'));
  const data=Buffer.concat(parts);
  const headers={...host,'content-type':'multipart/form-data; boundary='+boundary};
  const request=(authorization?:string)=>api.inject({method:'POST',url:'/api/screenshots/external',headers:{...headers,...(authorization?{authorization:'Bearer '+authorization}:{})},payload:data});
  const forbidden=await request();
  assert.equal(forbidden.statusCode,401);assert.equal(forbidden.body.includes(token),false);
  const first=await request(token);assert.equal(first.statusCode,200,first.body);assert.equal(first.json().result.duplicate,false);
  const retry=await request(token);assert.equal(retry.statusCode,200);assert.equal(retry.json().result.duplicate,true);
  assert.equal(retry.json().result.screenshot.id,first.json().result.screenshot.id);
 }finally{await api.close();fs.rmSync(root,{recursive:true,force:true});}
});
