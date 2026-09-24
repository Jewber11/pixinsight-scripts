# Adaptive Faint Emission

Activate an RGB image in PixInsight. Run **Script → Sam's Scripts → Adaptive Faint Emission** once. The script analyzes the image, computes luminance and RGB color selections, builds an emission mask, and creates a 32-bit floating-point enhanced result. It leaves the source unchanged. Save the result as XISF before closing PixInsight.

No per-image settings or script edits are needed. It supports both linear and stretched RGB images. The script uses the image's stored channel values. It does not apply an STF or global stretch. On a linear source, use an STF to inspect the result and mask.

## Output

- `AFE_..._result`: enhanced RGB image. The result inherits the source's FITS keywords and RGB working space.
- `AFE_..._mask`: combined faint red/cyan emission selection, values from 0 to 1. Use an STF only for display if the mask looks dark.

The process console reports sampled luminance levels, derived mask thresholds, gain scale, protected area, changed area, and highlight limiting. Each run derives these values anew. The script refuses to process its own result or mask by accident.

## Optional whole-region protection

Create an open grayscale image with the same dimensions as the source and give its main view the ID `<SourceViewId>_Protect`. White preserves the corresponding source pixels; black permits the edit; gray allows a partial edit. Run the script from the source window. No script setting needs changing. Without this image, protection follows luminance per pixel.

## How selection works

The script samples the source to estimate background luminance, its spread, the bright tail, background chroma, and red-versus-cyan separation. It derives faint and protection ranges from those measurements. A 3×3 RGB average drives the color mask so isolated colorful noise has less influence. The original pixel luminance controls highlight protection. The original channel values receive bounded gains, and shared headroom limiting prevents any output channel from exceeding 1. The source is read in tiles through PJSR `getSamples()` and the result and mask are written with `setSamples()`.

Red and cyan selections are color proxies. They are **not** calibrated Hα or OIII line measurements. Colorful sky noise, gradients, and dark gaps inside bright structures can still be selected. Inspect the mask and result before using them as a final image. A grayscale source cannot provide the RGB color information this method needs.

## Install or update

This folder belongs in the `PI_Scripts` repository. Build the package from the repository root with `./build-pixinsight-repository.sh`, commit and push it, then add or update the repository URL in PixInsight as described in the [main README](../README.md). A local build alone does not publish the update. For immediate local use, execute `AdaptiveFaintEmission.js` through **Script → Execute Script File...**.
