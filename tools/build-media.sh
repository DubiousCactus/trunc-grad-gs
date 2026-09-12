#!/usr/bin/env bash
# Regenerate the media that the project page actually serves.
#
#   Videos/site/     re-encoded side-by-side comparison clips (1280x720, CRF 27)
#   Videos/previews/ re-encoded ground-truth dataset clips   (854x480,  CRF 30)
#   figures/posters/ first-frame posters for the dataset cards
#
# Originals in Videos/Our_bench and Videos/N3DV are never modified.
# Requires ffmpeg. Run from the repository root:  bash tools/build-media.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Long edge only: the sources are 16:9 (1600x900) and 4:3 (1352x1014), so the
# other dimension must follow to avoid distorting the clips.
SITE_W=1280; SITE_CRF=27
PREV_W=854;  PREV_CRF=30

mkdir -p Videos/site Videos/previews figures/posters

# Comparison clips referenced by index.html. Basenames are preserved so the page
# only differs from the originals by its directory.
SITE_CLIPS=(
  Videos/Our_bench/tree_4dgs_base_web.mp4
  Videos/Our_bench/tree_4dgs_ours_web.mp4
  Videos/Our_bench/underwater_4dgs_base_web.mp4
  Videos/Our_bench/underwater_4dgs_ours_web.mp4
  Videos/Our_bench/cup_cem4dgs_base.mp4
  Videos/Our_bench/cup_cem4dgs_ours.mp4
  Videos/Our_bench/neon_22_cem4dgs_base.mp4
  Videos/Our_bench/neon_22_cem4dgs_ours.mp4
  Videos/Our_bench/alley_cem4dgs_base_web.mp4
  Videos/Our_bench/alley_cem4dgs_ours_web.mp4
  Videos/Our_bench/alley_4dgs_base_web.mp4
  Videos/Our_bench/alley_4dgs_ours_web.mp4
  Videos/Our_bench/bouncy_balls_4dgs_base_web.mp4
  Videos/Our_bench/bouncy_balls_4dgs_ours_web.mp4
  Videos/N3DV/flame_steak_base_web.mp4
  Videos/N3DV/flame_steak_ours_web.mp4
  Videos/N3DV/coffee_martini_4dgs_base_web.mp4
  Videos/N3DV/coffee_martini_4dgs_ours_web.mp4
)

for src in "${SITE_CLIPS[@]}"; do
  out="Videos/site/$(basename "$src")"
  echo "site:     $src"
  ffmpeg -v error -y -i "$src" \
    -vf "scale='min(${SITE_W},iw)':-2:flags=lanczos" \
    -c:v libx264 -profile:v high -crf "$SITE_CRF" -preset slow \
    -pix_fmt yuv420p -an -movflags +faststart "$out"
done

# Ground-truth clips of the proposed dataset, shown in the scene gallery.
for name in alley tree cup neon bouncy_balls underwater; do
  src="Videos/Our_bench/${name}_gt.mp4"
  [ -f "$src" ] || { echo "previews: $src (missing, skipped)"; continue; }
  echo "preview:  $src"
  ffmpeg -v error -y -i "$src" \
    -vf "scale='min(${PREV_W},iw)':-2:flags=lanczos" \
    -c:v libx264 -profile:v high -crf "$PREV_CRF" -preset slow \
    -pix_fmt yuv420p -an -movflags +faststart "Videos/previews/${name}_gt.mp4"
  ffmpeg -v error -y -ss 1 -i "$src" -frames:v 1 \
    -vf "scale='min(${PREV_W},iw)':-2:flags=lanczos" -q:v 4 "figures/posters/${name}_gt.jpg"
done

echo
echo "Videos/site:      $(du -sh Videos/site | cut -f1)"
echo "Videos/previews:  $(du -sh Videos/previews | cut -f1)"
