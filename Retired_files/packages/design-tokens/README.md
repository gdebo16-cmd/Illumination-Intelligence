# Design tokens

Named colors for the five Illumination Intelligence brands. `tokens.css` exposes them as custom properties under `[data-brand="…"]`. `tokens.json` is the same set for anything that cannot read CSS.

| Brand | Palette |
| --- | --- |
| Lumen | Steel blue / gunmetal |
| Umbra | Maroon / black |
| Prism | Prismatic (violet, cyan, magenta, amber) |
| Eclipse | Red / gunmetal |
| Halo | Cream / gold |

Apps mount this directory at `/design-tokens` and set `data-brand` on `<html>`. Change a color here, not in an app stylesheet.

The locked Artemis banners are in [`banners/`](banners/). Each app also keeps a copy at `static/banner.png`, which is the file the page actually shows.
