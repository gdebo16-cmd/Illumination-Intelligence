import type { PrismImage, RecentItem, Shown, TrackedJob } from './types';

// Everything you've made, newest first, in the side panel. Tap one to see it big.
export default function Gallery({
  jobs,
  images,
  recent,
  shown,
  show,
  remove,
}: {
  jobs: TrackedJob[];
  images: PrismImage[];
  recent: RecentItem[];
  shown: Shown | null;
  show: (next: Shown) => void;
  remove: (kind: Shown['kind'], id: string) => Promise<void>;
}) {
  return (
    <>
        {/* Everything you've made, newest first. Tap one to see it big. */}
        <span className="sidebar-separator">Your pictures</span>
        {recent.length === 0 && jobs.length === 0 ? (
          <p className="prism-note">Nothing yet. Your pictures and videos will collect here.</p>
        ) : (
          <nav className="prism-gallery" aria-label="Your pictures and videos">
            {/* Pictures being made: the picture they start from (if any), dimmed, with "…" */}
            {jobs.map((job) => {
              const from = job.sourceId ? images.find((i) => i.id === job.sourceId) : undefined;
              return (
                <button
                  key={`job-${job.id}`}
                  type="button"
                  className="prism-thumb is-working"
                  title={`Being made: ${job.prompt}`}
                  onClick={() => from && show({ kind: 'image', id: from.id })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- one of our own pictures */}
                  {from && <img src={from.url} alt="" />}
                  <span className="prism-thumb-badge" aria-hidden="true">…</span>
                </button>
              );
            })}
            {recent.map((item) => (
              <div className="prism-thumb-wrap" key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                className={`prism-thumb ${item.kind === 'video' ? `is-video is-${item.video.status}` : ''}`}
                aria-current={shown?.kind === item.kind && shown.id === item.id}
                title={item.kind === 'video' ? `Video: ${item.video.prompt}` : item.image.prompt}
                onClick={() => show({ kind: item.kind, id: item.id })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small thumbnails of our own pictures */}
                <img src={item.kind === 'video' ? item.video.poster : item.image.url} alt={item.kind === 'video' ? item.video.prompt : item.image.prompt} loading="lazy" />
                {item.kind === 'video' && (
                  <span className="prism-thumb-badge" aria-hidden="true">
                    {item.video.status === 'working' ? '…' : item.video.status === 'failed' ? '!' : '▶'}
                  </span>
                )}
              </button>
              {/* Delete it for good. Not offered while a video is still being made. */}
              {!(item.kind === 'video' && item.video.status === 'working') && (
                <button
                  type="button"
                  className="prism-thumb-delete"
                  aria-label={item.kind === 'video' ? 'Delete this video' : 'Delete this picture'}
                  title="Delete"
                  onClick={() => void remove(item.kind, item.id)}
                >
                  ✕
                </button>
              )}
              </div>
            ))}
          </nav>
        )}
    </>
  );
}
