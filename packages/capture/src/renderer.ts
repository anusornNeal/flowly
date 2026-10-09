import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import type { PreviewRevision, QaCase, ScreenSpec, BrowserStep } from '../../core/src/models.js';
import { DomainError } from '../../core/src/models.js';

export function executableOptions() {
 const options=[
  process.env.FLOWLY_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 ];
 const available=options.find(value=>value&&fs.existsSync(value));
 return available?{executablePath:available}:{};
}
export async function openChromium(headless:boolean):Promise<Browser>{
 try{return await chromium.launch({...executableOptions(),headless});}
 catch(error){throw new DomainError('BROWSER_UNAVAILABLE','Chromium browser unavailable. Install Chrome/Edge or run npx playwright install chromium.',503,
  {detail:String(error).slice(0,300)});}
}
export async function applySteps(page:Page,steps:BrowserStep[]){
 if(steps.length>200)throw new DomainError('TOO_MANY_STEPS','At most 200 saved browser steps');
 for(const step of steps){
  if(step.action==='navigate'){
   if(!step.url)throw new DomainError('INVALID_STEP','Navigate requires URL');
   await page.goto(step.url,{waitUntil:'domcontentloaded',timeout:15000});
   continue;
  }
  if(!step.selector)throw new DomainError('INVALID_STEP','Step requires selector');
  const locator=page.locator(step.selector).first();
  if(step.action==='click')await locator.click({timeout:9000});
  else if(step.action==='fill')await locator.fill(step.value||'',{timeout:9000});
  else if(step.action==='press')await locator.press(step.value||'Enter',{timeout:9000});
  else if(step.action==='select')await locator.selectOption(step.value||'',{timeout:9000});
  else if(step.action==='check')await locator.check({timeout:9000});
  else throw new DomainError('UNKNOWN_STEP','Unknown browser step action');
 }
}
async function pageFor(rev:PreviewRevision,screen:ScreenSpec){
 const browser=await openChromium(true);
 const context=await browser.newContext({viewport:{width:screen.viewport.width,height:screen.viewport.height},deviceScaleFactor:1,
  reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage();
 const runtimeErrors:string[]=[];
 page.on('pageerror',error=>runtimeErrors.push(error.message.slice(0,300)));
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith('data:')||url.startsWith('blob:'))return route.continue();
  return route.abort('blockedbyclient');
 });
 const html=rev.html.match(/<html/i)?rev.html:'<!doctype html><html><head></head><body>'+rev.html+'</body></html>';
 await page.setContent(html,{waitUntil:'domcontentloaded',timeout:12000});
 if(rev.css.trim())await page.addStyleTag({content:rev.css});
 if(rev.js.trim())await page.addScriptTag({content:rev.js});
 if(screen.steps?.length)await applySteps(page,screen.steps);
 await page.evaluate(async()=>{await document.fonts.ready;});
 return {browser,page,runtimeErrors};
}
export function targetScreen(rev:PreviewRevision,c:QaCase):ScreenSpec {
 const screen=rev.screens.find(s=>s.id===c.screenId&&s.stateId===c.stateId&&
  s.viewport.width===c.viewport.width&&s.viewport.height===c.viewport.height&&s.viewport.device===c.viewport.device);
 if(!screen)throw new DomainError('SCREEN_MISSING','QA target is not in Approved Preview');
 return screen;
}
export async function renderApproved(rev:PreviewRevision,c:QaCase):Promise<Buffer>{
 const {browser,page}=await pageFor(rev,targetScreen(rev,c));
 try{return await page.screenshot({type:'png',animations:'disabled',fullPage:false});}
 finally{await browser.close();}
}
export type QualityIssue={code:string;message:string;selector?:string;severity:'critical'|'warning';suggestion:string};
export async function inspectRendered(rev:PreviewRevision,screen:ScreenSpec) {
 const {browser,page,runtimeErrors}=await pageFor(rev,screen);
 try{
  const data=await page.evaluate(()=>{
   const out:Array<{code:string;message:string;selector?:string}>=[];
   const every=Array.from(document.querySelectorAll<HTMLElement>('body *')).slice(0,1500);
   const visible=every.filter(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;});
   if(document.documentElement.scrollWidth>innerWidth+4)
    out.push({code:'HORIZONTAL_OVERFLOW',message:'Page extends beyond viewport width'});
   for(const e of visible){
    const r=e.getBoundingClientRect(),label=e.id?'#'+e.id:e.tagName.toLowerCase();
    if((r.right>innerWidth+6||r.left< -6)&&getComputedStyle(e).position!=='fixed')
     out.push({code:'CLIPPED_VIEWPORT',message:'Visible element is outside viewport',selector:label});
    if(e.scrollWidth>e.clientWidth+8&&['hidden','clip'].includes(getComputedStyle(e).overflowX))
     out.push({code:'TEXT_CLIPPED',message:'Element clips horizontal content',selector:label});
   }
   for(const img of document.images)if(!img.complete||img.naturalWidth===0)
    out.push({code:'BROKEN_IMAGE',message:'Image not loaded',selector:img.id||img.alt||'img'});
   return out.slice(0,60);
  });
  const hints:Record<string,{severity:'critical'|'warning';suggestion:string}>={
   RUNTIME_ERROR:{severity:'critical',suggestion:'Fix exception in Preview JavaScript'},
   HORIZONTAL_OVERFLOW:{severity:'critical',suggestion:'Use responsive width, wrapping or contained scrolling'},
   BROKEN_IMAGE:{severity:'critical',suggestion:'Provide a reachable local or data-URL image asset'},
   REQUIRED_FONT_MISSING:{severity:'critical',suggestion:'Bundle the declared font locally with the Preview'},
   TEXT_CLIPPED:{severity:'warning',suggestion:'Check intended truncation or increase element width'},
   CLIPPED_VIEWPORT:{severity:'warning',suggestion:'Check responsive layout and intentional offscreen content'}
  };
  const issues:QualityIssue[]=[...data,...runtimeErrors.map(message=>({code:'RUNTIME_ERROR',message}))].map(issue=>({
   ...issue,severity:hints[issue.code]?.severity||'warning',
   suggestion:hints[issue.code]?.suggestion||'Inspect this element at the chosen viewport'
  }));
  const critical=issues.filter(i=>i.severity==='critical');
  return {screen:screen.id,state:screen.stateId,viewport:screen.viewport,issues,critical:critical.length,warnings:issues.length-critical.length,passed:critical.length===0&&issues.length===0};
 }finally{await browser.close();}
}
export async function compareImage(rev:PreviewRevision,c:QaCase,image:Buffer,format:'stats'|'diff'='stats'):
 Promise<{differencePercent:number;dimensionsDiffer:boolean;diff?:Buffer}>{
 const reference=await renderApproved(rev,c),width=c.viewport.width,height=c.viewport.height;
 const actualMeta=await sharp(image).metadata();
 const target=await sharp(reference).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const observed=await sharp(image).resize(width,height,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const pixels=width*height;
 let diffCount=0;
 const delta=Buffer.alloc(pixels*4);
 for(let i=0;i<pixels;i++){
  const offset=i*3,dr=Math.abs(target.data[offset]!-observed.data[offset]!),
   dg=Math.abs(target.data[offset+1]!-observed.data[offset+1]!),
   db=Math.abs(target.data[offset+2]!-observed.data[offset+2]!);
  const changed=Math.max(dr,dg,db)>24;
  if(changed)diffCount++;
  if(format==='diff'){
   const d=i*4;
   delta[d]=changed?240:observed.data[offset]!;
   delta[d+1]=changed?44:observed.data[offset+1]!;
   delta[d+2]=changed?61:observed.data[offset+2]!;
   delta[d+3]=255;
  }
 }
 const dimensionsDiffer=actualMeta.width!==width||actualMeta.height!==height;
 const diff=format==='diff'?await sharp(delta,{raw:{width,height,channels:4}}).png().toBuffer():undefined;
 return {differencePercent:Math.round(10000*diffCount/pixels)/100,dimensionsDiffer,diff};
}
