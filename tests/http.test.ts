import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';

function form(fields:Record<string,string>,img:Buffer,boundary='FLOWLY_BOUNDARY'){
 const parts:Buffer[]=[];
 for(const [key,value] of Object.entries(fields)){
  parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+value+'\r\n'));
 }
 parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n'));
 parts.push(img);
 parts.push(Buffer.from('\r\n--'+boundary+'--\r\n'));
 return {data:Buffer.concat(parts),type:'multipart/form-data; boundary='+boundary};
}
test('loopback HTTP operation parity, token-before-ingest, idempotency and rotation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-http-'));
 const api=await createServer({root});
 try{
  const health=await api.inject({url:'/api/health',headers:{host:'127.0.0.1:3210'}});
  assert.equal(health.statusCode,200);
  const foreign=await api.inject({url:'/api/projects',headers:{host:'127.0.0.1:3210',origin:'https://evil.example'}});
  assert.equal(foreign.statusCode,403);
  const projectRes=await api.inject({method:'POST',url:'/api/operations/project.create',
   headers:{host:'127.0.0.1:3210','content-type':'application/json'},payload:{name:'HTTP QA',platform:'web'}});
  assert.equal(projectRes.statusCode,200);
  const projectId=projectRes.json().result.id as string;
  const tokenRes=await api.inject({method:'POST',url:'/api/operations/settings.token.reveal',
   headers:{host:'127.0.0.1:3210','content-type':'application/json'},payload:{}});
  const token=tokenRes.json().result.token as string;
  assert.equal(token.length,64);
  const png=await sharp({create:{width:20,height:20,channels:3,background:'#663399'}}).png().toBuffer();
  const body=form({sourceId:'desktop',captureId:'seq-01',projectId},png);
  const noToken=await api.inject({method:'POST',url:'/api/screenshots/external',
   headers:{host:'127.0.0.1:3210','content-type':body.type},payload:body.data});
  assert.equal(noToken.statusCode,401);
  assert.equal(JSON.stringify(noToken.json()).includes(token),false);
  const authorized=()=>api.inject({method:'POST',url:'/api/screenshots/external',
   headers:{host:'127.0.0.1:3210',authorization:'Bearer '+token,'content-type':body.type},payload:body.data});
  const first=await authorized();assert.equal(first.statusCode,200,first.body);
  assert.equal(first.json().result.duplicate,false);
  const second=await authorized();assert.equal(second.statusCode,200,second.body);
  assert.equal(second.json().result.duplicate,true);
  assert.equal(first.json().result.screenshot.id,second.json().result.screenshot.id);
  const snapshot=await api.inject({url:'/api/snapshot/'+projectId,headers:{host:'127.0.0.1:3210'}});
  assert.equal(snapshot.json().result.screenshots.length,1);
  assert.equal(snapshot.body.includes(token),false);
  const regenerate=await api.inject({method:'POST',url:'/api/operations/settings.token.regenerate',
   headers:{host:'127.0.0.1:3210','content-type':'application/json'},payload:{confirm:true}});
  assert.equal(regenerate.statusCode,200);
  assert.notEqual(regenerate.json().result.token,token);
  assert.equal((await authorized()).statusCode,401);
  const file=await api.inject({url:'/api/screenshots/'+first.json().result.screenshot.id+'/file',
   headers:{host:'127.0.0.1:3210'}});
  assert.equal(file.statusCode,200);
  assert.equal(file.headers['content-type'],'image/png');
 }finally{await api.close();fs.rmSync(root,{recursive:true,force:true});}
});
