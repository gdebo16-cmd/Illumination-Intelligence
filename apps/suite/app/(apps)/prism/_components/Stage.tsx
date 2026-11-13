import { findPrismModel } from '@/config/prism-models';
import type { EnlargeChoice } from '@/lib/prism/upscale-plan';
import EnlargeButtons from './EnlargeButtons';
import SaveButton from './SaveButton';
import { aboutTime, clock, styleName, type LengthChoice, type Make, type PrismImage, type PrismVideo } from './types';

// The picture or video shown big, with what made it and what you can do with it.
export default function Stage({
  shownImage,
  shownVideo,
  busy,
  animating,
  lengths,
  now,
  startFrom,
  reuse,
  reuseVideo,
  enlarge,
}: {
  shownImage: PrismImage | undefined;
  shownVideo: PrismVideo | undefined;
  busy: boolean;
  animating: boolean;
  lengths: LengthChoice[];
  now: number;
  startFrom: (image: PrismImage, what: Make) => void;
  reuse: (image: PrismImage) => void;
  reuseVideo: (video: PrismVideo) => void;
  enlarge: (choice: EnlargeChoice, image?: PrismImage) => Promise<void>;
}) {
  return (
    <section className="prism-stage" aria-live="polite">
      {shownVideo ? (
        <figure className="prism-result">
          {shownVideo.status === 'done' ? (
            <video
              key={shownVideo.id}
              src={shownVideo.url}
              poster={shownVideo.poster}
              width={shownVideo.width}
              height={shownVideo.height}
              controls
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <div className="prism-video-wait">
              {/* eslint-disable-next-line @next/next/no-img-element -- the starting picture, from our own API */}
              <img src={shownVideo.poster} alt="" width={shownVideo.width} height={shownVideo.height} className="is-busy" />
              {shownVideo.status === 'working' ? (
                <VideoProgress video={shownVideo} lengths={lengths} now={now} />
              ) : (
                <p className="prism-video-status is-failed">{shownVideo.error ?? 'This video didn’t work.'}</p>
              )}
            </div>
          )}
          <figcaption>
            <span className="prism-caption-text">{shownVideo.prompt}</span>
            <span className="prism-caption-meta">
              Video · {Math.round(shownVideo.frames / 24)} sec · {shownVideo.width}×{shownVideo.height}
              {shownVideo.seconds ? ` · made in ${clock(shownVideo.seconds)}` : ''}
            </span>
            <span className="prism-caption-actions">
              <button type="button" onClick={() => reuseVideo(shownVideo)}>Reuse settings</button>
              {shownVideo.status === 'done' && (
                <SaveButton key={shownVideo.url} url={shownVideo.url} name={`prism-${shownVideo.id.slice(0, 8)}.mp4`} type="video/mp4" />
              )}
            </span>
          </figcaption>
        </figure>
      ) : shownImage ? (
        <figure className="prism-result">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated pictures, served by our own API */}
          <img src={shownImage.url} alt={shownImage.prompt} width={shownImage.width} height={shownImage.height} className={busy && !animating ? 'is-busy' : ''} />
          <figcaption>
            <span className="prism-caption-text">{shownImage.prompt}</span>
            <span className="prism-caption-meta">
              {shownImage.mode === 'edit' ? 'Edit · ' : shownImage.mode === 'upscale' ? 'Upscaled · ' : ''}{findPrismModel(shownImage.model).name} · {styleName(shownImage.style)} · {shownImage.width}×{shownImage.height}
              {shownImage.seconds ? ` · ${shownImage.seconds.toFixed(1)}s` : ''}
            </span>
            {/* With the prompt expander on: what it wrote, and so what the model really painted from */}
            {shownImage.expandedPrompt && (
              <details className="prism-expanded" key={shownImage.id}>
                <summary>See the expanded prompt</summary>
                <p>{shownImage.expandedPrompt}</p>
              </details>
            )}
            <span className="prism-caption-actions">
              <button type="button" onClick={() => startFrom(shownImage, 'edit')}>Edit this</button>
              <button type="button" onClick={() => startFrom(shownImage, 'video')}>Make video</button>
              <button type="button" onClick={() => reuse(shownImage)}>Reuse settings</button>
              <SaveButton key={shownImage.url} url={shownImage.url} name={`prism-${shownImage.id.slice(0, 8)}.png`} type="image/png" />
              <EnlargeButtons
                width={shownImage.width}
                height={shownImage.height}
                disabled={busy}
                onEnlarge={(choice) => void enlarge(choice, shownImage)}
              />
            </span>
          </figcaption>
        </figure>
      ) : (
        <div className="prism-empty">
          {busy ? 'Painting your first picture…' : 'Your pictures will appear here.'}
        </div>
      )}
    </section>
  );
}

/** "Making your video… 1:12 of about 2½ min", with a bar that fills up as it goes. */
function VideoProgress({ video, lengths, now }: { video: PrismVideo; lengths: LengthChoice[]; now: number }) {
  const wait = lengths.find((l) => l.id === video.length)?.wait ?? 150;
  const elapsed = Math.max(0, (now - Date.parse(video.createdAt)) / 1000);
  // Never show it as finished before it is: the bar stops at 95% if it runs long.
  const share = Math.min(0.95, elapsed / wait);
  return (
    <div className="prism-video-status">
      <span>
        Making your video… {clock(elapsed)} <small>of {aboutTime(wait)}</small>
      </span>
      <span className="prism-video-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </span>
    </div>
  );
}
