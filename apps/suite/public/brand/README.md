# Locked banners and icons

These are the Artemis marks Gabriel locked for Illumination Intelligence. `suite-sheet.jpg` is the contact sheet for the first five; Aegis, Refract and Astra were added from `Illumination_Assets.zip` (folder `Logos_Banners_Icons`).

| Brand | Banner (symbol + name, 2560×300) | Icon (symbol only, see-through, 192×192) |
| --- | --- | --- |
| Lumen | `lumen.png` | `icons/lumen.png` |
| Umbra | `umbra.png` | `icons/umbra.png` |
| Prism | `prism.png` | `icons/prism.png` |
| Eclipse | `eclipse.png` | `icons/eclipse.png` |
| Halo | `halo.png` | `icons/halo.png` |
| Aegis | `aegis.png` | `icons/aegis.png` |
| Refract | `refract.png` | `icons/refract.png` |
| Astra | `astra.png` | `icons/astra.png` |

The suite serves these at `/brand/<name>.png` and `/brand/icons/<name>.png`. `config/apps.ts` points each app at its banner and icon by its id, so the file name must match the app's id.

In the asset pack the banner is `<name>/banner-web.png` and the icon is `<name>/icons/icon-192.png`.
