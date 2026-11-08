# Shared UI

Shell for the Illumination Intelligence hello pages: page frame, wordmark, and the banner slot. There is no component package and no build. Lumen does not use this shell; it has its own chat layout.

An empty slot:

```html
<figure class="banner-slot">
  <div class="banner-inner">
    <span class="banner-label">Banner</span>
    <span class="banner-note">Banner not in place.</span>
  </div>
</figure>
```

A locked banner. The image is `apps/<brand>/static/banner.png`.

```html
<figure class="banner-slot has-art">
  <img class="banner-art" src="/static/banner.png" alt="Prism" />
</figure>
```

Apps mount this directory at `/shared-ui`. Brand color comes from `packages/design-tokens`, selected with `data-brand` on `<html>`.
