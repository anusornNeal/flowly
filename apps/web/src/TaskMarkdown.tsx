import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function TaskMarkdown({content,emptyMessage='Nothing provided.'}:{content:string;emptyMessage?:string}){
 if(!content.trim())return <p className="task-empty">{emptyMessage}</p>;
 return <div className="task-markdown">
  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
   a:({href,children})=><a href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
  }}>{content}</ReactMarkdown>
 </div>;
}
