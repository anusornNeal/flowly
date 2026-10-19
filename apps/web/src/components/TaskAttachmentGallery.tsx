import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import './taskAttachments.css';

/** Shared modal boundary: native inert background, explicit Tab loop, focus restore. */
export function TaskMediaDialog({ onKeyDown, ...props }: ComponentPropsWithoutRef<'dialog'>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog {...props} ref={dialog} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'))
      .filter(element => !element.matches(':disabled,[hidden],[tabindex="-1"]') && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} />;
}

/** View adapter, not a server DTO. Map canonical attachment metadata and API-owned
 * media URLs here. Missing/deleted references may retain id/name with no src.
 * Never pass filesystem paths or external URLs. Array order is display order. */
export interface TaskAttachmentImage {
  id: string;
  name: string;
  altText?: string;
  src?: string;
  thumbnailSrc?: string;
  missing?: boolean;
}
export interface TaskAttachmentGalleryProps {
  attachments?: readonly TaskAttachmentImage[] | null;
  status?: string;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Callbacks reject on failure; parent refreshes controlled metadata on success.
   * Server must independently enforce Done/permission guards. Delete is confirmed
   * here. Removed Markdown references must remain safe missing placeholders. */
  onRemove?: (attachment: TaskAttachmentImage) => Promise<void> | void;
  onAltTextChange?: (attachment: TaskAttachmentImage, altText: string) => Promise<void> | void;
  /** Shell opens its own picker/composer and uses canonical attachment append API. */
  onAdd?: () => void;
}

export function safeTaskImageSource(source?: string, origin = typeof window === 'undefined' ? undefined : window.location.origin): string | undefined {
  if (!source || !origin || /[\\\s\u0000-\u001f]/.test(source)) return undefined;
  try {
    const url = new URL(source, origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function GalleryImage({ attachment, thumbnail = false, onOpen }: { attachment: TaskAttachmentImage; thumbnail?: boolean; onOpen?: () => void }) {
  const source = safeTaskImageSource(thumbnail ? attachment.thumbnailSrc ?? attachment.src : attachment.src);
  const [failedSource, setFailedSource] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  if (attachment.missing || !source) return <span className="task-media-fallback" role="status">Image missing. Update any Markdown reference.</span>;
  if (failedSource === source) return <span className="task-media-fallback" role="status">Image unavailable. Check your connection.
    <button type="button" onClick={() => { setFailedSource(undefined); setAttempt(attempt + 1); }}>Retry image</button></span>;
  const image = <img key={`${source}-${attempt}`} src={source} alt={attachment.altText || attachment.name} title={attachment.name} loading={thumbnail ? 'lazy' : 'eager'} onError={() => setFailedSource(source)} />;
  return onOpen ? <button type="button" className="task-media-image-button" aria-label={`Enlarge ${attachment.name}`} onClick={onOpen}>{image}</button> : image;
}

function AltTextEditor({ attachment, disabled, onSave }: { attachment: TaskAttachmentImage; disabled: boolean; onSave: (value: string) => void }) {
  const [value, setValue] = useState(attachment.altText ?? '');
  useEffect(() => setValue(attachment.altText ?? ''), [attachment.altText]);
  return <form className="task-media-alt" onSubmit={event => { event.preventDefault(); onSave(value); }}>
    <label>Alt text for {attachment.name}<input disabled={disabled} value={value} onChange={event => setValue(event.target.value)} /></label>
    <button type="submit" disabled={disabled || value === (attachment.altText ?? '')}>Save alt text</button>
  </form>;
}

function AttachmentLightbox({ attachments, activeId, onSelect, onClose }: {
  attachments: readonly TaskAttachmentImage[]; activeId: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const id = useId();
  const index = attachments.findIndex(item => item.id === activeId);
  const attachment = attachments[index];
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { setZoom(false); if (!attachment) close.current(); }, [activeId, attachment]);
  const move = (direction: number) => {
    if (attachments.length) onSelect(attachments[(Math.max(0, index) + direction + attachments.length) % attachments.length].id);
  };
  return <TaskMediaDialog className="task-media task-media-lightbox" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }}>
    <header className="task-media-actions"><h2 id={`${id}-title`} className="task-media-name">{attachment?.name ?? 'Image missing'}</h2>
      <button type="button" onClick={onClose} autoFocus>Close image</button></header>
    {attachment && <><div className={`task-media-stage${zoom ? ' is-zoomed' : ''}`} tabIndex={0} aria-label="Image view; scroll when zoomed">
      <GalleryImage key={attachment.id} attachment={attachment} />
    </div><p className="task-media-name">{attachment.altText || attachment.name}</p></>}
    <footer className="task-media-actions">
      <button type="button" disabled={attachments.length < 2} onClick={() => move(-1)} aria-label="Previous image">← Previous</button>
      <span role="status">{index < 0 ? 0 : index + 1} / {attachments.length}</span>
      <button type="button" disabled={attachments.length < 2} onClick={() => move(1)} aria-label="Next image">Next →</button>
      <button type="button" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? 'Fit image' : 'Zoom image'}</button>
    </footer>
  </TaskMediaDialog>;
}

export function TaskAttachmentGallery({ attachments, status, readOnly = false, loading = false, error, onRetry, onRemove, onAltTextChange, onAdd }: TaskAttachmentGalleryProps) {
  const images = attachments ?? [];
  const [activeId, setActiveId] = useState<string>();
  const [confirmId, setConfirmId] = useState<string>();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [localError, setLocalError] = useState('');
  const immutable = readOnly || status?.toLowerCase() === 'done';
  const disabled = immutable || loading || pending;
  const mutate = async (action: () => Promise<void> | void) => {
    if (disabled || locked.current) return;
    locked.current = true; setPending(true); setLocalError('');
    try { await action(); setConfirmId(undefined); }
    catch (failure) { setLocalError(failure instanceof Error ? failure.message : 'Could not save changes. Try again.'); }
    finally { locked.current = false; setPending(false); }
  };
  return <section className="task-media task-media-gallery" aria-label="Task images" aria-busy={loading || pending}>
    <header className="task-media-actions"><h3>Images ({images.length})</h3>
      {!immutable && onAdd && <button type="button" disabled={disabled || images.length >= 10} onClick={onAdd}>Add images</button>}
      {immutable && <span className="task-media-muted">Read only</span>}</header>
    {loading && <p role="status">Loading images…</p>}
    {(error || localError) && <div role="alert"><p>{error || localError}</p>{onRetry && <button type="button" disabled={loading || pending} onClick={onRetry}>Retry loading</button>}</div>}
    {!loading && !error && images.length === 0 && <p className="task-media-muted">No images attached.</p>}
    <ul className="task-media-grid">{images.map(item => <li key={item.id}>
      <div className="task-media-thumbnail"><GalleryImage key={`${item.src}-${item.thumbnailSrc}-${item.missing}`} attachment={item} thumbnail onOpen={() => setActiveId(item.id)} /></div>
      <button type="button" className="task-media-open" aria-label={`Open image ${item.name}`} onClick={() => setActiveId(item.id)}>{item.name}</button>
      {!immutable && onAltTextChange && <AltTextEditor attachment={item} disabled={disabled} onSave={text => { void mutate(() => onAltTextChange(item, text)); }} />}
      {!immutable && onRemove && (confirmId === item.id ? <div className="task-media-confirm" role="group" aria-label={`Confirm removal of ${item.name}`}>
        <p>Remove this image? Update any Markdown references after removal.</p>
        <button type="button" disabled={disabled} onClick={() => { void mutate(() => onRemove(item)); }}>Confirm remove</button>
        <button type="button" disabled={disabled} onClick={() => setConfirmId(undefined)}>Keep image</button>
      </div> : <button type="button" disabled={disabled} aria-label={`Remove ${item.name}`} onClick={() => setConfirmId(item.id)}>Remove</button>)}
    </li>)}</ul>
    {pending && <p role="status">Saving image changes…</p>}
    {activeId && <AttachmentLightbox attachments={images} activeId={activeId} onSelect={setActiveId} onClose={() => setActiveId(undefined)} />}
  </section>;
}
