'use client';

// Adding photos to a chat message. Shared by Lumen and a Flicker's chat in Umbra.
//
// The add-photo button only belongs on screen for a model that can see images. Each chat works
// that out with canSeeImages() (config/models.ts) and passes the answer to usePhotos().

import { useEffect, useRef, useState } from 'react';
import { MAX_PHOTOS, chatImageUrl } from '@/config/models';

/** A photo picked but not sent yet. `preview` is a temporary browser address for showing it. */
export interface Photo {
  file: File;
  preview: string;
}

/** Biggest photo we send (the server has the same limit). */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Free the browser memory behind photo previews once they're no longer shown. */
export const releasePhotos = (photos: Photo[]) => photos.forEach((p) => URL.revokeObjectURL(p.preview));

/**
 * The photos waiting to go out with the next message.
 * `enabled` is whether the current model can see images; while it can't, there are no photos
 * (so switching to a model that can't see never sends it one).
 */
export function usePhotos(enabled: boolean) {
  const [picked, setPicked] = useState<Photo[]>([]);
  const [problem, setProblem] = useState('');
  const photos = enabled ? picked : [];

  // Leaving the page: free whatever previews are still held.
  const held = useRef<Photo[]>([]);
  useEffect(() => {
    held.current = picked;
  }, [picked]);
  useEffect(() => () => releasePhotos(held.current), []);

  const add = (files: File[]) => {
    if (!enabled || files.length === 0) return;
    const pictures = files.filter((f) => f.type.startsWith('image/') && f.size <= MAX_PHOTO_BYTES);
    const room = MAX_PHOTOS - picked.length;
    setProblem(
      pictures.length > room
        ? `Up to ${MAX_PHOTOS} photos per message.`
        : files.some((f) => !f.type.startsWith('image/'))
          ? 'Only pictures can be added.'
          : pictures.length < files.length
            ? 'That photo is too big (over 25 MB).'
            : '',
    );
    const added = pictures
      .slice(0, Math.max(0, room))
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));
    if (added.length) setPicked([...picked, ...added]);
  };

  const remove = (photo: Photo) => {
    releasePhotos([photo]);
    setPicked(picked.filter((p) => p !== photo));
    setProblem('');
  };

  /** Hand over the photos for sending and empty the tray. Call releasePhotos() on them when done. */
  const take = () => {
    setPicked([]);
    setProblem('');
    return photos;
  };

  /** For the message box: pasting a copied picture adds it as a photo. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!enabled || !files.some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    add(files);
  };

  return { photos, problem: enabled ? problem : '', add, remove, take, onPaste };
}

/** The add-photo button. Render it only when the model can see images. */
export function PhotoButton({ onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="photo-button"
        aria-label="Add a photo"
        title="Add a photo"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="3" />
          <circle cx="8.5" cy="9.5" r="1.6" />
          <path d="M21 15.5l-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 19.2" />
        </svg>
      </button>
      {/* On a phone this opens the usual sheet: photo library, or take one with the camera. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onPick([...(e.target.files ?? [])]);
          e.target.value = ''; // so picking the same photo again still counts
        }}
      />
    </>
  );
}

/** The photos waiting to be sent, each with a remove button. Sits just above the message box. */
export function PhotoTray({ photos, problem, onRemove }: { photos: Photo[]; problem: string; onRemove: (photo: Photo) => void }) {
  if (photos.length === 0 && !problem) return null;
  return (
    <div className="photo-tray">
      {photos.map((photo) => (
        <span key={photo.preview} className="photo-chip">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked photo */}
          <img src={photo.preview} alt={photo.file.name} />
          <button type="button" aria-label={`Remove ${photo.file.name}`} title="Remove" onClick={() => onRemove(photo)}>✕</button>
        </span>
      ))}
      {problem && <span className="photo-problem" role="alert">{problem}</span>}
    </div>
  );
}

/**
 * The photos inside a sent message. Each entry is a saved photo's id, or (for a message that was
 * only just sent) the local preview address.
 */
export function MessagePhotos({ images, withText }: { images?: string[]; withText?: boolean }) {
  if (!images?.length) return null;
  return (
    <div className={`message-photos ${withText ? 'has-text' : ''}`}>
      {images.map((image) => (
        // eslint-disable-next-line @next/next/no-img-element -- a local preview, or a photo from our own API
        <img key={image} src={image.startsWith('blob:') ? image : chatImageUrl(image)} alt="Attached photo" />
      ))}
    </div>
  );
}
