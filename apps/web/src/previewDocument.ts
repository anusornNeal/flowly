import type { Preview, ScreenSpec } from '../../../packages/core/src/models.js';

/** Build a self-contained, network-isolated author preview. State changes never mutate saved source. */
export function previewDocument(draft: Preview['draft'], target?: ScreenSpec): string {
 const id = JSON.stringify({ screenId: target?.id || '', stateId: target?.stateId || 'default' });
 const controls = `(() => {
   const initial = ${id};
   let active = { ...initial };
   const history = [];
   const nodes = () => Array.from(document.querySelectorAll('[data-flowly-screen], [data-flowly-state]'));
   const render = (next, remember) => {
     if (remember) history.push({ ...active });
     active = { screenId: String(next.screenId || ''), stateId: String(next.stateId || 'default') };
     for (const el of nodes()) {
       const screen = el.getAttribute('data-flowly-screen');
       const state = el.getAttribute('data-flowly-state');
       const inScreen = el.closest('[data-flowly-screen]');
       const visible = (!screen || screen === active.screenId)
         && (!state || state === active.stateId)
         && (!inScreen || inScreen.getAttribute('data-flowly-screen') === active.screenId);
       el.hidden = !visible;
     }
     document.dispatchEvent(new CustomEvent('flowly:state-change', { detail: { ...active } }));
   };
   document.addEventListener('click', (event) => {
     if (!(event.target instanceof Element)) return;
     const action = event.target.closest('[data-flowly-go]');
     if (!action) return;
     event.preventDefault();
     const target = (action.getAttribute('data-flowly-go') || '').split('|');
     render({ screenId: target.length > 1 ? target[0] : active.screenId, stateId: target.length > 1 ? target[1] : target[0] }, true);
   });
   window.addEventListener('message', (event) => {
     if (event.source !== window.parent) return;
     const data = event.data;
     if (data?.type === 'flowly-preview-back' && history.length) render(history.pop(), false);
     if (data?.type === 'flowly-preview-select') { history.length = 0; render({ screenId: data.screenId, stateId: data.stateId }, false); }
     if (data?.type === 'flowly-preview-reset') { history.length = 0; render(initial, false); }
   });
   render(initial, false);
 })();`;
 return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; font-src data:; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>[hidden]{display:none!important}' +
    draft.css + '</style></head><body>' + draft.html + '<script>' + controls + '</script><script>' + draft.js + '</script></body></html>';
}
