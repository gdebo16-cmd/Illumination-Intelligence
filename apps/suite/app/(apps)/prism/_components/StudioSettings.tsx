import { PRISM_STYLES } from '@/config/prism-styles';
import {
  PRISM_VIDEO_MODELS, VIDEO_SHAPES, findVideoModel, isCloudVideo,
  type VideoModelId, type VideoShapeId,
} from '@/config/prism-video-models';
import { SHAPES, type ModelChoice, type ShapeId } from './types';

// The side panel's pickers: model (and its prompt expander), art style and shape.
export default function StudioSettings({
  animating,
  fromWords,
  editing,
  models,
  model,
  setModel,
  expand,
  setExpand,
  style,
  setStyle,
  shape,
  setShape,
  videoModel,
  setVideoModel,
  videoShape,
  setVideoShape,
  videoReady,
}: {
  animating: boolean;
  fromWords: boolean;
  editing: boolean;
  models: ModelChoice[];
  model: string;
  setModel: (id: string) => void;
  expand: boolean;
  setExpand: (on: boolean) => void;
  style: string;
  setStyle: (id: string) => void;
  shape: ShapeId;
  setShape: (id: ShapeId) => void;
  videoModel: VideoModelId;
  setVideoModel: (id: VideoModelId) => void;
  videoShape: VideoShapeId;
  setVideoShape: (id: VideoShapeId) => void;
  videoReady: (id: VideoModelId) => boolean;
}) {
  const pickedModel = models.find((m) => m.id === model);
  const pickedStyle = PRISM_STYLES.find((s) => s.id === style);
  return (
    <>
      {animating ? (
        <>
          <label className="sidebar-separator" htmlFor="prism-video-model">Video model</label>
          <select
            id="prism-video-model"
            className="prism-select"
            value={videoModel}
            onChange={(e) => setVideoModel(e.target.value as VideoModelId)}
          >
            {PRISM_VIDEO_MODELS.map((m) => (
              <option key={m.id} value={m.id} disabled={!videoReady(m.id)}>
                {videoReady(m.id) ? m.name : `${m.name} (${isCloudVideo(m.id) ? 'not set up yet' : 'not downloaded yet'})`}
              </option>
            ))}
          </select>
          <p className="prism-note">{findVideoModel(videoModel).note}</p>
          {!videoReady(videoModel) && (
            <p className="prism-note">
              {isCloudVideo(videoModel)
                ? 'Cloud Movies need a Comfy account key first. See lib/prism/cloud.ts.'
                : `${fromWords ? 'Videos from words' : 'Videos from a picture'} need more files for this model. See docs/prism-video.md.`}
            </p>
          )}

          <span className="sidebar-separator" id="prism-video-shape-label">Shape</span>
          {fromWords ? (
            <div className="prism-shapes" role="radiogroup" aria-labelledby="prism-video-shape-label">
              {VIDEO_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={videoShape === s.id}
                  className="prism-shape"
                  onClick={() => setVideoShape(s.id)}
                >
                  <span className={`prism-shape-icon is-${s.id}`} />
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="prism-note">The video keeps your picture?s shape.</p>
          )}
        </>
      ) : (
        <>
          <label className="sidebar-separator" htmlFor="prism-model">Model</label>
          <select id="prism-model" className="prism-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.ready}>
                {m.ready ? m.name : `${m.name} (${m.cloud ? 'not set up yet' : 'not downloaded yet'})`}
              </option>
            ))}
          </select>
          <p className="prism-note">{pickedModel?.note}</p>

          {/* Only for a model with a prompt expander (FLUX.3) */}
          {pickedModel?.expands && (
            <label className="prism-check">
              <input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} />
              <span>
                Expand my prompt
                <span>
                  {editing
                    ? 'A helper looks at your picture and writes out the change in detail. This model works best that way.'
                    : 'A helper rewrites your prompt into a long, detailed one. This model paints best from those.'}
                </span>
              </span>
            </label>
          )}

          <label className="sidebar-separator" htmlFor="prism-style">Art style</label>
          <select id="prism-style" className="prism-select" value={style} onChange={(e) => setStyle(e.target.value)}>
            {PRISM_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {/* A style with a LoRA (a trained add-on) only fits the model it was trained on */}
          {pickedStyle?.loras && (
            <p className="prism-note">
              {model in pickedStyle.loras
                ? 'This style was trained on your own art.'
                : 'This style wasn’t trained for this model, so you only get its words and the look will be weaker.'}
            </p>
          )}

          <span className="sidebar-separator" id="prism-shape-label">Shape</span>
          {editing ? (
            <p className="prism-note">The result keeps your picture’s shape.</p>
          ) : (
            <div className="prism-shapes" role="radiogroup" aria-labelledby="prism-shape-label">
              {SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={shape === s.id}
                  className="prism-shape"
                  onClick={() => setShape(s.id)}
                >
                  {/* A little outline in the shape's proportions */}
                  <span className="prism-shape-icon" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
