'use client';

import { useEffect, useState } from 'react';

// "Save" for a picture or video. On a phone it opens the share sheet, where "Save Image" or
// "Save Video" puts it in Photos. (A plain download link in the Home Screen app opens a
// full-screen viewer with no way back.) On a computer it downloads the file like before.
// The file is fetched as soon as it's shown, so the share sheet can open right on the tap.
// (Each picture gets a fresh button, key={url}, so it never offers the previous picture's file.)
export default function SaveButton({ url, name, type }: { url: string; name: string; type: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!live) return;
        const f = new File([blob], name, { type: blob.type || type });
        setFile(f);
        setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [url, name, type]);

  const download = (href: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const save = async () => {
    if (file && canShare) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // Closing the share sheet isn't an error.
        if ((err as Error).name !== 'AbortError') download(URL.createObjectURL(file));
      }
      return;
    }
    if (file) {
      const href = URL.createObjectURL(file);
      download(href);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      return;
    }
    setSaving(true);
    download(url);
    setSaving(false);
  };

  const label = canShare ? (type.startsWith('video') ? 'Save video' : 'Save to Photos') : 'Download';
  return (
    <button type="button" onClick={() => void save()} disabled={saving}>
      {label}
    </button>
  );
}
