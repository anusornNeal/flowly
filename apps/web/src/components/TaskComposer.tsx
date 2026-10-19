import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './taskAttachments.css';
import { TaskMediaDialog } from './TaskAttachmentGallery';

import { TASK_IMAGE_LIMIT, TASK_IMAGE_ACCEPT, validateTaskImage } from '../taskImageValidation.js';
export { TASK_IMAGE_LIMIT, TASK_IMAGE_MAX_BYTES, TASK_IMAGE_ACCEPT, validateTaskImage } from '../taskImageValidation.js';

export interface TaskDraftAttachment { id: string; file: File; altText: string }
export interface TaskComposerValue {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  attachments: TaskDraftAttachment[];
}
export interface TaskComposerProps {
  open: boolean;
  value: TaskComposerValue;
  kind?: 'task' | 'subtask' | 'bug';
  parentId?: string;
  mode?: 'create' | 'add';
  existingCount?: number;
  onChange: (value: TaskComposerValue) => void;
  /** Persist once, atomically, with files in array order. Parent owns retry/idempotency key.
   * No network/staging happens here. Keep value on failure; reset it on success/cancel.
   * Map kind=subtask to type=task + parentId and enforce hierarchy/permissions upstream. */
  onSubmit: (value: TaskComposerValue, context: { kind: 'task' | 'subtask' | 'bug'; parentId?: string }) => Promise<void> | void;
  /** Must discard the controlled draft and close; no server cleanup is needed. */
  onCancel: () => void;
  submitting?: boolean;
  progress?: number;
  error?: string;
  fileErrors?: Readonly<Record<string, string>>;
  /** Integrator supplies canonical syntax and remaps draft IDs during atomic create.
   * Omit until backend reference contract exists; never persist blob URLs in Markdown. */
  getAttachmentMarkdown?: (attachment: TaskDraftAttachment) => string;
  /** Safe renderer supplied by shell; raw HTML/remote image loading must be disabled. */
  renderDescriptionPreview?: (markdown: string) => ReactNode;
}

/** Browser checks are advisory; backend must decode and validate actual image bytes. */
export function DraftImagePreview({ file, alt }: { file: File; alt: string }) {
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    setBroken(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (broken) return <span role="status">Preview unavailable. Remove this file or verify it is a valid image.</span>;
  return preview?.file === file ? <img src={preview.url} alt={alt} onError={() => setBroken(true)} /> : <span>Loading preview…</span>;
}

export function TaskComposer({ open, value, kind = 'task', parentId, mode = 'create', existingCount = 0, onChange, onSubmit, onCancel,
  submitting = false, progress, error, fileErrors, getAttachmentMarkdown, renderDescriptionPreview }: TaskComposerProps) {
  const description = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [validation, setValidation] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const id = useId();
  const busy = submitting || pending;
  useEffect(() => { if (!open) { setValidation([]); setLocalError(''); setPreview(false); } }, [open]);
  if (!open) return null;
  const update = (patch: Partial<TaskComposerValue>) => onChange({ ...value, ...patch });
  const addFiles = (files: File[]) => {
    if (busy) return;
    const attachments = [...value.attachments];
    const errors: string[] = [];
    for (const file of files) {
      const reason = validateTaskImage(file) ?? (attachments.length + existingCount >= TASK_IMAGE_LIMIT ? 'Maximum 10 images per card.' : undefined);
      if (reason) errors.push(`${file.name}: ${reason}`);
      else attachments.push({ id: crypto.randomUUID(), file, altText: '' });
    }
    setValidation(errors);
    update({ attachments });
  };
  const cancel = () => { if (!busy) onCancel(); };
  return <TaskMediaDialog className="task-media task-composer" aria-labelledby={`${id}-heading`}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || locked.current || !value.title.trim()) return;
      if (value.attachments.length + existingCount > TASK_IMAGE_LIMIT || value.attachments.some(item => validateTaskImage(item.file))) {
        setLocalError('Remove invalid images before creating this card.'); return;
      }
      locked.current = true; setPending(true); setLocalError('');
      try { await onSubmit({ ...value, title: value.title.trim() }, { kind, parentId }); }
      catch (failure) { setLocalError(failure instanceof Error ? failure.message : 'Creation failed. Your draft is retained; try again.'); }
      finally { locked.current = false; setPending(false); }
    }} onPaste={event => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); addFiles(files); }
    }}>
      <h2 id={`${id}-heading`}>{mode === 'add' ? 'Add images' : `Create ${kind}`}</h2>
      {parentId && <p className="task-media-muted">Parent: {parentId}</p>}
      <fieldset disabled={busy}>
        {mode === 'create' && <><label htmlFor={`${id}-title`}>Title (required)</label>
        <input autoFocus id={`${id}-title`} required value={value.title} onChange={event => update({ title: event.target.value })} />
        <label htmlFor={`${id}-description`}>Description (Markdown)</label>
        <textarea ref={description} id={`${id}-description`} rows={6} value={value.description} onChange={event => update({ description: event.target.value })} />
        {renderDescriptionPreview && <><button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}> {preview ? 'Hide preview' : 'Preview description'}</button>
          {preview && <div className="task-media-description">{renderDescriptionPreview(value.description)}</div>}</>}
        <label htmlFor={`${id}-priority`}>Priority</label>
        <select id={`${id}-priority`} value={value.priority} onChange={event => update({ priority: event.target.value as TaskComposerValue['priority'] })}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select></>}
        <section aria-label="Draft images" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
          onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
          <div className="task-media-dropzone">
            <strong>Images · {value.attachments.length + existingCount}/10</strong>
            <p id={`${id}-help`}>Drop images here, paste into this form, or choose files. PNG, JPEG, WebP · up to 25 MiB each.</p>
            <input ref={picker} type="file" multiple accept={TASK_IMAGE_ACCEPT} hidden onChange={event => {
              addFiles(Array.from(event.target.files ?? [])); event.target.value = '';
            }} />
            <button type="button" aria-describedby={`${id}-help`} onClick={() => picker.current?.click()}>Choose images</button>
          </div>
          <ul className="task-media-drafts">
            {value.attachments.map((item, index) => <li key={item.id}>
              <DraftImagePreview file={item.file} alt={item.altText || item.file.name} />
              <div className="task-media-draft-fields">
                <strong className="task-media-name">{item.file.name}</strong>
                <span className="task-media-muted">{(item.file.size / 1024 / 1024).toFixed(2)} MiB</span>
                <label>Alt text for {item.file.name}<input maxLength={2000} value={item.altText} onChange={event => update({ attachments: value.attachments.map(attachment => attachment.id === item.id ? { ...attachment, altText: event.target.value } : attachment) })} /></label>
                {(fileErrors?.[item.id] || validateTaskImage(item.file)) && <p role="alert">{fileErrors?.[item.id] || validateTaskImage(item.file)}</p>}
                <div className="task-media-actions">
                  {[-1, 1].map(direction => <button key={direction} type="button" disabled={index + direction < 0 || index + direction >= value.attachments.length}
                    aria-label={`Move ${item.file.name} ${direction < 0 ? 'earlier' : 'later'}`} onClick={() => {
                      const attachments = [...value.attachments];
                      [attachments[index], attachments[index + direction]] = [attachments[index + direction], attachments[index]];
                      update({ attachments });
                    }}>{direction < 0 ? '↑' : '↓'}</button>)}
                  <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => update({ attachments: value.attachments.filter(attachment => attachment.id !== item.id) })}>Remove</button>
                  {getAttachmentMarkdown && <button type="button" onClick={() => {
                    const editor = description.current;
                    const start = editor?.selectionStart ?? value.description.length;
                    const end = editor?.selectionEnd ?? start;
                    const markdown = getAttachmentMarkdown(item);
                    update({ description: value.description.slice(0, start) + markdown + value.description.slice(end) });
                    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + markdown.length, start + markdown.length); });
                  }}>Insert in description</button>}
                </div>
              </div>
            </li>)}
          </ul>
        </section>
      </fieldset>
      {validation.length > 0 && <div role="alert"><ul>{validation.map((message, index) => <li key={index}>{message}</li>)}</ul><button type="button" onClick={() => setValidation([])}>Dismiss file errors</button></div>}
      {(error || localError) && <p role="alert">{error || localError}</p>}
      {busy && <div role="status">{mode === 'add' ? 'Adding images…' : 'Creating card…'} <progress aria-label="Saving images" max={100} value={progress === undefined ? undefined : Math.max(0, Math.min(100, progress))} /></div>}
      <footer className="task-media-actions">
        <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
        <button className="task-media-primary" type="submit" disabled={busy || !value.title.trim() || (mode === 'add' && !value.attachments.length)}>{mode === 'add' ? 'Add images' : `Create ${kind}`}</button>
      </footer>
    </form>
  </TaskMediaDialog>;
}
