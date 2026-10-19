import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './ThemeSelect.css';

export type SelectOption={value:string;label:string;disabled?:boolean;group?:string};
export type ThemeSelectProps={value?:string;defaultValue?:string;options:SelectOption[];onChange?:(value:string)=>void;onFocus?:()=>void;placeholder?:string;disabled?:boolean;ariaLabel:string;id?:string;invalid?:boolean;describedBy?:string;dark?:boolean};

/** A single-select combobox: focus stays on the trigger, with an active listbox descendant. */
export function ThemeSelect({value,defaultValue='',options,onChange,onFocus,placeholder='Choose…',disabled=false,ariaLabel,id,invalid,describedBy,dark=false}:ThemeSelectProps){
 const generated=useId();const listId=generated+'-list';
 const [internal,setInternal]=useState(defaultValue);
 const selected=value??internal;
 const [open,setOpen]=useState(false);
 const [active,setActive]=useState(-1);
 const [position,setPosition]=useState({left:0,top:0,width:0,maxHeight:280});
 const trigger=useRef<HTMLButtonElement>(null);const popup=useRef<HTMLDivElement>(null);
 const typeahead=useRef({text:'',at:0});
 const enabled=options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);
 const selectedIndex=options.findIndex(option=>option.value===selected);
 const openMenu=()=>{if(disabled)return;setActive(enabled.includes(selectedIndex)?selectedIndex:enabled[0]??-1);setOpen(true);};
 const close=()=>setOpen(false);
 const choose=(index:number)=>{const option=options[index];if(!option||option.disabled||disabled)return;setInternal(option.value);onChange?.(option.value);close();trigger.current?.focus();};
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{
   const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
   const height=window.visualViewport?.height??innerHeight;
   const below=height-rect.bottom-8,above=rect.top-8;
   const up=below<Math.min(280,options.length*44+12)&&above>below;
   const maxHeight=Math.max(44,Math.min(280,up?above:below));
   const width=Math.min(Math.max(rect.width,180),innerWidth-16);
   setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-width-8)),top:up?Math.max(8,rect.top-maxHeight-4):rect.bottom+4,width,maxHeight});
  };
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);window.visualViewport?.addEventListener('resize',place);
  const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))close();};
  document.addEventListener('pointerdown',outside,true);
  return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);document.removeEventListener('pointerdown',outside,true);};
 },[open,options.length]);
 useEffect(()=>{if(disabled)close();},[disabled]);
 useEffect(()=>{if(open)document.getElementById(listId+'-'+active)?.scrollIntoView({block:'nearest'});},[open,active,listId]);
 return <><button ref={trigger} type="button" id={id} className={'theme-select-trigger'+(dark?' is-dark':'')} role="combobox" aria-label={ariaLabel}
  aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} aria-activedescendant={open&&active>=0?listId+'-'+active:undefined}
  aria-invalid={invalid||undefined} aria-describedby={describedBy} disabled={disabled}
  onFocus={onFocus} onClick={()=>open?close():openMenu()} onBlur={()=>close()}
  onKeyDown={event=>{
   const key=event.key;
   if(key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();return;}
   if(key==='Tab'){close();return;}
   if(key==='ArrowUp'&&event.altKey&&open){event.preventDefault();close();return;}
   if(key==='Enter'||key===' '){event.preventDefault();if(open)choose(active);else openMenu();return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(key)){
    event.preventDefault();if(!open){openMenu();if(key==='Home')setActive(enabled[0]??-1);if(key==='End')setActive(enabled.at(-1)??-1);return;}
    const current=enabled.indexOf(active);
    setActive(key==='Home'?enabled[0]??-1:key==='End'?enabled.at(-1)??-1:enabled[(current+(key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]??-1);return;
   }
   if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    event.preventDefault();const now=Date.now();const previous=now-typeahead.current.at<700?typeahead.current.text:'';
    const text=previous+key.toLocaleLowerCase();typeahead.current={text,at:now};
    const query=[...text].every(char=>char===text[0])?text[0]!:text;
    const start=query.length===1?active+1:active;
    const ordered=[...enabled.filter(index=>index>=start),...enabled.filter(index=>index<start)];
    const match=ordered.find(index=>options[index]!.label.toLocaleLowerCase().startsWith(query));
    if(!open)openMenu();if(match!==undefined)setActive(match);
   }
  }}><span>{options[selectedIndex]?.label??placeholder}</span><ChevronDown size={15} aria-hidden="true"/></button>
  {open&&createPortal(<div ref={popup} className={'theme-select-popup'+(dark?' is-dark':'')} style={position} id={listId} role="listbox" aria-label={ariaLabel}
   onPointerDown={event=>event.preventDefault()}>
   {options.map((option,index)=><div key={option.value+'-'+index}>
    {option.group&&option.group!==options[index-1]?.group&&<div className="theme-select-group">{option.group}</div>}
    <div role="option" id={listId+'-'+index} aria-label={option.group?option.group+': '+option.label:undefined} aria-selected={option.value===selected} aria-disabled={option.disabled||undefined}
     className={'theme-select-option'+(active===index?' is-active':'')} onPointerMove={()=>{if(!option.disabled)setActive(index);}} onClick={()=>choose(index)}>
     <span>{option.label}</span>{option.value===selected&&<Check size={15} aria-hidden="true"/>}
    </div></div>)}
   {!options.length&&<div className="theme-select-empty">No options available</div>}
  </div>,trigger.current?.closest('[role="dialog"]')??document.body)}
 </>;
}

const syncEvent='flowly-select-sync';
export function syncThemeSelects(){document.dispatchEvent(new Event(syncEvent));}

/** Progressive enhancement retains native form values, validation and React change callbacks.
 * This adapter also covers shared screens without modifying their independently owned source. */
function NativeSelect({select}:{select:HTMLSelectElement}){
 const [,update]=useState(0);
 useLayoutEffect(()=>{
  const sync=()=>update(value=>value+1);
  const observer=new MutationObserver(sync);observer.observe(select,{attributes:true,childList:true,characterData:true,subtree:true});
  select.addEventListener('change',sync);document.addEventListener(syncEvent,sync);
  const labels=Array.from(select.labels??[]);
  const focus=(event:MouseEvent)=>{if(event.target===event.currentTarget){event.preventDefault();document.getElementById(select.dataset.themeTrigger!)?.focus();}};
  labels.forEach(label=>label.addEventListener('click',focus));
  return ()=>{observer.disconnect();select.removeEventListener('change',sync);document.removeEventListener(syncEvent,sync);labels.forEach(label=>label.removeEventListener('click',focus));};
 },[select]);
 const label=select.getAttribute('aria-label')||Array.from(select.labels??[]).map(label=>Array.from(label.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim()).join(' ')||'Choose option';
 return <ThemeSelect id={select.dataset.themeTrigger} value={select.value} options={Array.from(select.options).map(option=>({value:option.value,label:option.label,disabled:option.disabled||(option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled),group:option.parentElement instanceof HTMLOptGroupElement?option.parentElement.label:undefined}))}
  disabled={select.disabled} ariaLabel={label} invalid={select.getAttribute('aria-invalid')==='true'} describedBy={select.getAttribute('aria-describedby')??undefined} dark={Boolean(select.closest('.sidebar'))}
  onFocus={()=>select.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))}
  onChange={value=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));queueMicrotask(()=>update(previous=>previous+1));}}/>;
}

export function ThemeSelectEnhancer(){
 const [targets,setTargets]=useState<Array<{select:HTMLSelectElement;host:HTMLSpanElement}>>([]);
 useLayoutEffect(()=>{
  const entries=new Map<HTMLSelectElement,HTMLSpanElement>();let count=0;
  const scan=()=>{
   let changed=false;
   for(const [select,host] of entries)if(!select.isConnected){host.remove();entries.delete(select);changed=true;}
   document.querySelectorAll<HTMLSelectElement>('select:not([multiple])').forEach(select=>{
    if(entries.has(select))return;
    const host=document.createElement('span');host.className='theme-select-host';
    select.dataset.themeTrigger='theme-select-'+(++count);select.classList.add('theme-select-native');
    select.after(host);entries.set(select,host);changed=true;
   });
   if(changed)setTargets(Array.from(entries,([select,host])=>({select,host})));
  };
  scan();const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});
  return ()=>{observer.disconnect();for(const [select,host] of entries){host.remove();select.classList.remove('theme-select-native');delete select.dataset.themeTrigger;}};
 },[]);
 return <>{targets.map(({select,host})=>createPortal(<NativeSelect select={select}/>,host,select.dataset.themeTrigger))}</>;
}
