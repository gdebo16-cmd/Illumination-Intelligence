import { choicesFor, type EnlargeChoice } from '@/lib/prism/upscale-plan';

/** Fast 4×, Photo 4×, and Enhance to 4K or 8K. Hidden once the picture is already that big. */
export default function EnlargeButtons({
  width,
  height,
  disabled,
  onEnlarge,
}: {
  width: number;
  height: number;
  disabled: boolean;
  onEnlarge: (choice: EnlargeChoice) => void;
}) {
  const choices = choicesFor(width, height);
  if (!choices.length) return null;
  return (
    <span className="prism-enlarge">
      <span className="prism-enlarge-note">Fast and Photo only enlarge. Enhance can invent fine detail, such as hair.</span>
      {choices.map((choice) => (
        <button
          key={`${choice.target}-${choice.fastModel ?? 'enhance'}`}
          type="button"
          title={choice.title}
          disabled={disabled}
          onClick={() => onEnlarge(choice)}
        >
          {choice.label}
        </button>
      ))}
    </span>
  );
}
