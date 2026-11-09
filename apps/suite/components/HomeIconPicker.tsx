'use client';

import { HOME_ICONS, homeIconUrl, setHomeIcon, useHomeIcon } from '@/hooks/use-home-icon';

// Lets you choose which logo symbol becomes the iPhone home-screen icon.
// iPhone saves the icon when you add the app, so pick first, then Share → Add to Home Screen.
const HomeIconPicker = () => {
  const current = useHomeIcon();

  return (
    <div className="home-icon-picker">
      <div className="home-icon-picker-title">Home screen icon</div>
      <div className="home-icon-picker-options" role="radiogroup" aria-label="Home screen icon">
        {HOME_ICONS.map((icon) => (
          <button
            key={icon.id}
            type="button"
            role="radio"
            aria-checked={current === icon.id}
            aria-label={icon.name}
            title={icon.name}
            className="home-icon-option"
            onClick={() => setHomeIcon(icon.id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon, no optimisation needed */}
            <img src={homeIconUrl(icon.id)} alt="" width={40} height={40} />
          </button>
        ))}
      </div>
      <p className="home-icon-picker-hint">Pick one, then Share → Add to Home Screen.</p>
    </div>
  );
};

export default HomeIconPicker;
