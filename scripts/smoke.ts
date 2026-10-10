import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createServer } from '../apps/api/src/server.js';
import { openChromium } from '../packages/capture/src/renderer.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-smoke-'));
const artifactDir=path.join(process.cwd(),'data','qa');
fs.mkdirSync(artifactDir,{recursive:true});
const errors:string[]=[];
const api=await createServer({root});
let browser:Awaited<ReturnType<typeof openChromium>>|undefined;
try{
 const base=await api.listen({host:'127.0.0.1',port:0});
 browser=await openChromium(true);
 const desktop=await browser.newPage({viewport:{width:1450,height:900},deviceScaleFactor:1});
 desktop.on('pageerror',error=>errors.push(error.message));
 await desktop.goto(base+'/',{waitUntil:'networkidle'});
 await desktop.getByRole('dialog').getByRole('textbox',{name:'Project name'}).fill('QA Workspace');
 await desktop.getByRole('dialog').getByRole('button',{name:'Create project'}).click();
 await desktop.getByText('Keep every delivery in view').waitFor();
 const fontAssets=await desktop.evaluate(async()=>{
  const thai=await document.fonts.load('400 16px "LINE Seed Sans TH"','ภาษาไทย');
  const latin=await document.fonts.load('600 14px "Inter Variable"','FLY-0001');
  return {thai:thai.length,latin:latin.length};
 });
 if(fontAssets.thai<1||fontAssets.latin<1)throw Error('Self-hosted fonts unavailable '+JSON.stringify(fontAssets));
 await desktop.getByRole('button',{name:/Task Board/}).first().click();
 await desktop.locator('#new-task-title').fill('Capture QA Case');
 await desktop.locator('.quick-create button').click();
 await desktop.getByText('Capture QA Case').waitFor();
 await desktop.screenshot({path:path.join(artifactDir,'desktop.png'),fullPage:true});
 // Full Web flow: real Preview authoring, frozen revision and explicit Approval create QA cases.
 await desktop.getByRole('button',{name:/Preview & Visual QA/}).first().click();
 await desktop.getByPlaceholder('New preview name').fill('QA Mock Preview');
 await desktop.getByRole('combobox',{name:'Link preview to task'}).selectOption({label:'FLY-0001: Capture QA Case'});
 await desktop.getByRole('button',{name:'New preview'}).click();
 await desktop.getByRole('button',{name:'Freeze revision'}).click();
 await desktop.getByText('Rev 1').waitFor();
 desktop.on('dialog',dialog=>void dialog.accept());
 await desktop.getByRole('button',{name:'Approve revision'}).click();
 await desktop.getByText('Awaiting verdict').first().waitFor();
 const caseCount=await desktop.locator('.qa-case-row').count();
 if(caseCount!==1)throw Error('Expected exactly one QA case from explicit Approved Preview, got '+caseCount);
 await desktop.screenshot({path:path.join(artifactDir,'preview.png'),fullPage:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true});
 mobile.on('pageerror',error=>errors.push(error.message));
 await mobile.goto(base+'/',{waitUntil:'networkidle'});
 await mobile.getByRole('button',{name:/Task Board/}).first().click();
 await mobile.getByText('Capture QA Case').waitFor();
 const mobileWidth=await mobile.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 const mobileNav=await mobile.locator('nav[aria-label="Main navigation"]').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));
 if(mobileNav.scroll>mobileNav.width+1)throw Error('Mobile navigation label clipped '+JSON.stringify(mobileNav));
 await mobile.screenshot({path:path.join(artifactDir,'mobile.png'),fullPage:true});
 const appRoot=await mobile.locator('.flowly-app').count();
 await sharp(path.join(artifactDir,'desktop.png')).resize({width:900}).jpeg({quality:65}).toFile(path.join(artifactDir,'desktop-preview.jpg'));
 await sharp(path.join(artifactDir,'mobile.png')).resize({width:390}).jpeg({quality:65}).toFile(path.join(artifactDir,'mobile-preview.jpg'));
 if(!appRoot)throw Error('App root absent');
 if(mobileWidth.scroll>mobileWidth.viewport+2)throw Error('Mobile horizontal overflow '+JSON.stringify(mobileWidth));
 if(errors.length)throw Error('Browser runtime errors '+JSON.stringify(errors));
 console.log(JSON.stringify({ok:true,desktop:'data/qa/desktop-preview.jpg',mobile:'data/qa/mobile-preview.jpg',
  mobileWidth,appRoot,runtimeErrors:errors.length,taskCreated:true,projectCreated:true,previewCreated:true,qaCaseCreated:true}));
}finally{
 await browser?.close();
 await api.close();
 fs.rmSync(root,{recursive:true,force:true});
}
