import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import type { TaskAttachmentDto } from '../../../packages/core/src/models.js';
import { referencedTaskImage, taskImageUrl } from './taskImageUrls.js';

function InlineTaskImage({src,alt}:{src:string;alt:string}){
 const [failed,setFailed]=useState(false);
 return failed?<span role="status">Image unavailable: {alt}. Update the Markdown reference.</span>:<img src={src} alt={alt} loading="lazy" onError={()=>setFailed(true)}/>;
}
export default function TaskMarkdown({content,emptyMessage='Nothing provided.',attachments=[]}:{content:string;emptyMessage?:string;attachments?:readonly TaskAttachmentDto[]}){
 if(!content.trim())return <p className="task-empty">{emptyMessage}</p>;
 return <div className="task-markdown">
  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
   a:({href,children})=><a href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
   img:({src,alt})=>{
    const attachment=referencedTaskImage(typeof src==='string'?src:undefined,attachments);
    return attachment?<InlineTaskImage key={src} src={taskImageUrl(String(src))!} alt={alt||attachment.altText||attachment.name}/>:<span role="status">Image missing or blocked: {alt||'image'}. Update the Markdown reference.</span>;
   },
  }}>{content}</ReactMarkdown>
 </div>;
}
