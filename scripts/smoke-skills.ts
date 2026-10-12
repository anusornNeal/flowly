import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {FlowlyApp} from '../packages/core/src/app.js';
import {createServer} from '../apps/api/src/server.js';
import {openChromium} from '../packages/capture/src/renderer.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-skills-smoke-'));
const out=path.join(process.cwd(),'data','qa');fs.mkdirSync(out,{recursive:true});
const app=new FlowlyApp(root);
const author={actor:'agent-author',channel:'cli' as const};
const project=app.tasks.createProject({name:'Skill Visual QA'},author);
const content='---\nname: custom-quality\ndescription: Project checks for safe task completion.\n---\n# Custom Quality\nRequire real QA evidence.';
const revised='---\nname: custom-quality\ndescription: Project checks with exact revision verification.\n---\n# Custom Quality\nRequire real current QA evidence and independent review.';
app.skills.importProject({projectId:project.id,content,triggers:['custom quality']},author);
const proposal=app.learning.propose({projectId:project.id,skillId:'custom-quality',
  candidateVersion:'1.1.0',candidateContent:revised,
  explanation:'User requested stricter checks for new version approvals'},author);
const server=await createServer({root});
let browser:Awaited<ReturnType<typeof openChromium>>|undefined;
try{
 const base=await server.listen({host:'127.0.0.1',port:0});
 browser=await openChromium(true);
 const desktop=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const errors:string[]=[];
 desktop.on('pageerror',e=>errors.push(e.message));
 desktop.on('dialog',d=>void d.accept());
 await desktop.goto(base+'/',{waitUntil:'networkidle'});
 await desktop.getByRole('button',{name:'Skill Engine'}).first().click();
 await desktop.getByRole('heading',{name:/Skill Engine/}).waitFor();
 await desktop.getByText('Versioned skills').waitFor();
 const catalog=await desktop.locator('.skill-line').count();
 if(catalog<10)throw Error('Expected >= 10 catalog skills, got '+catalog);
 const skillRoute=desktop.getByLabel('Agent intent');
 await skillRoute.fill('review custom quality');
 await desktop.getByLabel('Include project guidance').check();
 await desktop.getByRole('button',{name:'Evaluate route'}).click();
 await desktop.locator('.skill-route-result').getByText(/custom-quality/).waitFor();
 await desktop.locator('.skill-timeline button.skill-history-item').first().click();
 await desktop.getByLabel('Proposal decision reason').fill('Separate reviewer approved verified improvement');
 await desktop.getByRole('button',{name:'Approve',exact:true}).click();
 await desktop.getByText('Proposal decision audited.').waitFor();
 if(app.skills.get({projectId:project.id,id:'custom-quality'}).manifest.version!=='1.1.0')
  throw Error('UI approval did not actually import selected Skill version');
 const audit=app.tasks.activity(project.id).filter(x=>x.action==='skill.learning.approve');
 if(audit.length!==1)throw Error('Expected exactly one audited approval, got '+audit.length);
 await desktop.screenshot({path:path.join(out,'skill-engine-desktop.png'),fullPage:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true});
 mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.goto(base+'/',{waitUntil:'networkidle'});
 await mobile.getByRole('button',{name:'Skill Engine'}).first().click();
 await mobile.getByRole('heading',{name:/Skill Engine/}).waitFor();
 await mobile.getByText('Versioned skills').waitFor();
 const width=await mobile.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 if(width.scroll>width.viewport+2)throw Error('Skill UI mobile horizontal overflow '+JSON.stringify(width));
 const isVisible=await mobile.getByText('Review proposals').isVisible();
 if(!isVisible)throw Error('Mobile proposal section missing');
 await mobile.screenshot({path:path.join(out,'skill-engine-mobile.png'),fullPage:true});
 if(errors.length)throw Error('Frontend runtime errors: '+errors.join('; '));
 console.log(JSON.stringify({ok:true,catalog,proposal:proposal.id,approvalAudited:true,
  latestVersion:app.skills.get({projectId:project.id,id:'custom-quality'}).manifest.version,
  viewport:width,desktop:'data/qa/skill-engine-desktop.png',mobile:'data/qa/skill-engine-mobile.png',
  runtimeErrors:errors.length}));
}finally{
 await browser?.close();
 await server.close();
 await app.close();
 fs.rmSync(root,{recursive:true,force:true});
}
