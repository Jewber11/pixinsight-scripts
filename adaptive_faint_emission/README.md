# Adaptive Faint Emission

Open an RGB image in PixInsight and run **Script → Sam's Scripts → Adaptive Faint Emission**. The GUI selects the source, recipe, operation, optional exclusion mask, thresholds, gains, and tone controls. It leaves the source unchanged and remembers recipe, operation, diagnostic-mask choice, progress interval, and custom values.

| Operation | Result |
|---|---|
| **Enhance** | Analyze image, compute mask, create a 32-bit floating-point RGB result and an emission mask. Enable seven diagnostic masks if wanted. |
| **Analyze** | Report sampled luminance and full-image coverage; optionally create masks. |
| **Masks** | Create all seven masks and a predicted change map, without an RGB result. |

**Analyze Source** refreshes image statistics and, in Adaptive mode, the displayed derived parameters. Changing any numeric mask, gain, or tone value switches to **Custom**. Select the original source view in the GUI for each run.

## Recipes

- **Adaptive** derives the faint band, bright protection, chroma and red/cyan gates, and gain scale from the current image. It uses 3×3 RGB averaging to reduce isolated color noise and limits gains near white. Use this for other RGB images.
- **Exact Guide** implements every pointwise equation and default value from the supplied `VeilFaintEmission_Guide.md`: original-pixel luminance and RGB color gates, smooth faint and emission masks, the five multiplicative gains, `strength`, clipping, and optional exclusion. It has no spatial averaging or global tone. All seven masks are enabled by default. Use an already stretched RGB image for this preset.
- **Veil target look** combines Adaptive with an optional global RGB tone fitted to the supplied original and edited TIFFs. It is an **approximation** for that Veil image; it is not the guide's exact recipe and may not suit other images.
- **Custom** exposes all eight mask thresholds, five gains, overall strength, RGB smoothing, highlight limiting, three black points, three scales, three gammas, and saturation. No script editing is needed.

The guide's luminance is `Y = 0.2126R + 0.7152G + 0.0722B` on stored RGB samples. Its faint gate is `S(faintStart,faintFull,Y) × [1 − S(faintFade,protectFrom,Y)]`. Chroma is `max(R,G,B) − min(R,G,B)`. The red/cyan selections use `R − (G+B)/2` and its negative with the faint and chroma gates. Gains use the original RGB channels. The script uses tiled PJSR reads and writes rather than per-pixel image API calls.

Global tone is neutral in Adaptive and Exact Guide. When enabled in Veil target look or Custom, it subtracts per-channel black points, scales, applies per-channel gamma, then adjusts saturation. This changes **all** pixels, including those protected from faint-emission gains. It is separate from the guide's faint-only formula.

## Diagnostic images

| Suffix | Meaning |
|---|---|
| `_Faint` | Original-luminance faint gate. |
| `_ColorGate` | RGB chroma gate. |
| `_Ha` | Faint reddish selection. |
| `_Oiii` | Faint cyan selection. |
| `_Emission` | Maximum of red and cyan selections. |
| `_Protected` | White where source luminance reaches the protection threshold; elsewhere the optional exclusion value. Protection applies to faint-emission gains. |
| `_Change` | Maximum absolute predicted RGB channel change, including optional global tone. |

A mask can appear dark while nonzero. Use PixInsight's STF for display only. The console reports p01/p50/p99 luminance, thresholds, protected, masked, and changed fractions, gain clipping candidates, tone clipping, and protected-pixel float conversion difference in Exact Guide output.

## Whole-region exclusion

Create an open grayscale image of the same dimensions: white over areas to preserve from faint-emission gains, black elsewhere, gray for partial protection. Enter its view ID under **Exclusion mask ID**. If empty, the script automatically looks for `<SourceViewId>_Protect`. This handles dark gaps inside a bright complex that per-pixel luminance protection cannot cover. Global tone, when enabled, still changes these pixels.

## Supplied Veil original and target

`final_print_test.tif` is **8183×12262**. `Veil_selected_faint_Ha_OIII_print_master.tif` is **1024×1536**. About **99.8%** of pixels in a downsized copy of the original exceed the guide's fixed `protectFrom = 0.160`; Exact Guide therefore changes almost nothing on this source. The target also has broad contrast and color changes outside the guide's equations. Exact Guide **cannot** regenerate the supplied target.

The Veil target look preset reduces mean absolute RGB error against the supplied target from **0.100 to 0.071** in a PixInsight test on a matched-size copy of the original (normalized values). It remains visibly different: local detail and the resize cannot be recovered from the guide. The script preserves the source's native dimensions; resize separately when needed. Use Adaptive for other images and inspect masks before saving.

Red/cyan selections are color proxies, not calibrated Hα/OIII line measurements. Colorful sky noise can still pass. Save the result as **32-bit floating-point XISF**. The output copies source FITS keywords and RGB working space, but not an embedded TIFF ICC profile; assign or check the intended profile before print export.

## Installation

The published repository URL is:

```text
https://raw.githubusercontent.com/Jewber11/pixinsight-scripts/main/pixinsight-repository/
```

In PixInsight choose **Resources → Updates → Manage Repositories → Add**, enter the URL, check for updates, apply, and restart. For immediate local use choose **Script → Execute Script File...** and open `AdaptiveFaintEmission.js`. The [main README](../README.md) describes repository packaging.
