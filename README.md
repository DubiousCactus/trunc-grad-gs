# TruncGradGS — project page

Static project page for *TruncGradGS: Improved 3D Gaussian Splatting via Truncated
Gradient Updates* ([arXiv:2609.03534](https://arxiv.org/abs/2609.03534)).

Open `index.html` through a local web server (the comparison viewer loads clips over
HTTP; opening the file directly with `file://` also works in most browsers):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Layout

```
index.html          the whole page: hero, overview, method, comparisons, benchmark,
                    qualitative comparison, results, citation
css/style.css       theme, layout and table styling
js/main.js          lazy media loading, canvas wipe viewer, scroll spy, citation copy
figures/            web-optimised figures and dataset poster frames
Videos/site/        the comparison clips the page actually serves
Videos/previews/    downscaled ground-truth clips for the dataset gallery
tools/build-media.sh regenerates Videos/site, Videos/previews and figures/posters
```

`Videos/Our_bench` and `Videos/N3DV` hold the full-resolution source clips. They are
large and are **not** tracked by git; the page never loads them directly.

## Adding the missing dataset clip

The dataset gallery expects a ground-truth clip for every scene. `underwater_gt.mp4` is
not in the repository yet, so that one card shows a "coming soon" placeholder. Drop the
render into `Videos/Our_bench/underwater_gt.mp4` and rebuild:

```bash
bash tools/build-media.sh
```

The card picks the clip up on the next load. Any scene card whose clip is missing keeps
the placeholder instead of breaking.

## Editing the content

- The comparison viewer draws both clips into **one canvas** rather than stacking two
  `<video>` layers. Chrome composites two video layers identically, but Firefox rendered
  a visible brightness step at the wipe boundary even though the two files agree to under
  a level; a single drawing surface removes that difference by construction. The draw loop
  is timer-driven so the canvas also paints while the clips are paused.
- Results tables are plain HTML inside `index.html`; best values per column carry
  `class="num best"` and rows of our method carry `class="ours"`.
- Maths (the truncated gradient formulation in Method) is written as `\(inline\)` /
  `\[display\]` and rendered by KaTeX from a CDN — the page's only external dependency.
  Dropping the three KaTeX tags from the `<head>` leaves a dependency-free page.
- To regenerate the media after adding or replacing source clips, edit the clip list in
  `tools/build-media.sh` and run it; it needs `ffmpeg`.

## Hosting

The page is ready for GitHub Pages: all asset paths are relative, so it also works from
a project subpath (`user.github.io/repo/`), and `.nojekyll` stops Jekyll from processing
the assets. Serve the repository root — `index.html` sits at the top level.
