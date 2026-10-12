import type { SkillManifest, SkillReason, SkillRoute, SkillSelection } from './skillContracts.js';
import type { Lane, Risk } from './workflow.js';

export type SkillRouterInput = {
  intent?: string;
  projectId?: string;
  taskStatus?: Lane;
  risk?: Risk;
  platform?: 'web'|'mobile'|'desktop';
  allowProjectGuidance?: boolean;
};
type RouteCandidate = { id: string; reason: SkillReason };
const intents = {
  author: /\b(card|task|author|spec|requirement|write ticket|create ticket)\b|การ์ด|เขียนสเปก|สร้างงาน|เขียนงาน/iu,
  source: /\b(jira|figma|atlas|source evidence|confluence|reference)\b|อ้างอิง|หลักฐานต้นทาง/iu,
  split: /\b(parallel|decompos(?:e|ition)?|split tasks|workstreams|dependencies)\b|ขนาน|แตกงาน|แยกงาน/iu,
  code: /\b(implement|coding|code|refactor|bugfix|fix bug|develop|ship feature)\b|ลงมือทำ|ทำต่อให้เสร็จ|แก้โค้ด|แก้บั๊ก|พัฒนา|ทำฟีเจอร์/iu,
  loop: /\b(loop|continue|keep working|finish all|work through board|next card)\b|ทำต่อ|วนงาน|ทำให้จบ|ทำจนเสร็จ/iu,
  review: /\b(review|audit|inspect change|approve|reject)\b|รีวิว|ตรวจโค้ด|อนุมัติ|ตรวจงาน/iu,
  design: /\b(ui|ux|layout|responsive|preview|screenshot|visual|design)\b|หน้าจอ|ออกแบบ|แคป|ภาพหน้าจอ|จัดหน้า/iu,
  verify: /\b(test|verify|verification|regression|typecheck|smoke|quality)\b|เทส|ทดสอบ|ยืนยันผล/iu,
};
const roles: Record<string, SkillReason> = {
  'agent-bootstrap':'BOOTSTRAP',
  'card-authoring':'AUTHORING',
  'source-evidence':'SOURCE_EVIDENCE',
  decomposition:'DECOMPOSITION',
  implementation:'IMPLEMENTATION',
  'board-loop':'BOARD_LOOP',
  review:'REVIEW',
  'ui-ux':'VISUAL_QA',
  verification:'VERIFICATION',
  'skill-router':'NO_MATCH',
};
/**
 * Pure and deterministic routing. Only the user's explicit intent, durable task
 * status and trusted skill metadata inform selection. Task descriptions are not
 * interpreted as executable instructions.
 */
export function routeSkills(manifests: readonly SkillManifest[], input: SkillRouterInput): SkillRoute {
  const text=(input.intent||'').slice(0,3000).trim();
  const choose: RouteCandidate[]=[];
  const add=(id:string,reason:SkillReason=roles[id]||'NO_MATCH')=>{
    if(!choose.some(c=>c.id===id))choose.push({id,reason});
  };
  if (!text && !input.projectId && !input.taskStatus) add('agent-bootstrap');
  if (intents.loop.test(text)) add('board-loop');
  if (intents.review.test(text)) add('review');
  if (intents.author.test(text)) add('card-authoring');
  if (intents.code.test(text)) add('implementation');
  if (intents.design.test(text)) add('ui-ux');
  if (intents.verify.test(text)) add('verification');
  if (intents.split.test(text)) add('decomposition');
  if (intents.source.test(text)) add('source-evidence');
  // Explicit intent wins; durable Task status is a fallback when user asks a vague question.
  if(!choose.length){
    if(input.taskStatus==='ready-for-review')add('review');
    else if(input.taskStatus==='in-progress'||input.taskStatus==='todo')add('implementation');
    else if(input.taskStatus==='backlog')add('card-authoring');
    else if(input.taskStatus==='done')add('review');
    else add('skill-router');
  }
  // A board loop is coordinated with implementation, and UI QA needs its verification guidance.
  if(choose.some(c=>c.id==='board-loop')&&!choose.some(c=>c.id==='implementation'))
    add('implementation');
  if(choose.some(c=>c.id==='ui-ux')&&/(qa|visual|ตรวจ|เทส|test)/iu.test(text))
    add('verification');
  const allowed=manifests.filter(m=>m.enabled &&
    (m.source==='builtin' || input.allowProjectGuidance===true && m.source==='project' && m.projectId===input.projectId) &&
    (m.scope==='global' || m.projectId===input.projectId));
  const selected: SkillSelection[]=[];
  for(const c of choose){
    const m=allowed.find(x=>x.id===c.id);
    if(!m)continue;
    selected.push({skillId:m.id,version:m.version,sha256:m.sha256,reason:c.reason});
    if(selected.length>=3)break;
  }
  if(!selected.length){
    const fallback=allowed.find(x=>x.id==='skill-router');
    if(fallback)selected.push({skillId:fallback.id,version:fallback.version,sha256:fallback.sha256,reason:'NO_MATCH'});
  }
  return {schemaVersion:1,selected,reason:selected[0]?.reason||'NO_MATCH',
    ...(selected.length===0?{requiresChoice:true}: {})};
}
