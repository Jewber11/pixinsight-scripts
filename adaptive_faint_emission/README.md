# Adaptive Faint Emission

Enhance faint detail in an open RGB image with **Script → Sam's Scripts → Adaptive Faint Emission**. Select the source, choose a subject, inspect the before/after preview, adjust sliders, then run at full resolution. The source is unchanged. The script creates a 32-bit floating-point RGB result and an emission/selection mask.

## Quick workflow

1. Open a **stretched RGB image** in PixInsight. Select it in the dialog. Image statistics are sampled automatically.
2. Choose **Auto** for a balanced starting point, or choose a subject below. The mask thresholds, gains, and tone/color defaults are recomputed from source pixels.
3. Click **Preview**. It samples the original into an RGB image with a long edge of at most 1200 pixels, runs the same enhancement math, and shows before/after inside the dialog. No permanent preview windows remain.
4. Adjust **Faint detail**, **Shadows**, **Highlights**, **Midtone curve**, and **Color** sliders; click Preview again. Changing a slider switches to Custom and preserves the selected subject's mask behavior.
5. Click **Enhance full image**. The preview is approximate: sparse averaging and a different scale can change how tiny stars, noise, and filaments are selected.

The **Tone + color** tab offers sliders for individual red, green, and blue black points, scales, and midtone curves, plus saturation. The **Masks + gains** tab exposes precise threshold/gain values and lets you select Hybrid, Emission, or Luminance masking. The **Output** tab offers analyze-only and seven-mask modes, an exclusion mask, RGB smoothing, highlight protection, and progress interval. The dialog remembers the selected subject, operation, mask option, and Custom parameters.

## Subjects and automatic values

| Subject | Starting behavior |
|---|---|
| **Auto** | Hybrid faint-luminance and red/cyan color selection; mild neutral tone. No claim of automatic semantic classification. |
| **Emission nebula / supernova remnant** | Red/cyan selection with Hα/OIII-like color gains; moderate image-derived tone. |
| **Galaxy** | Luminance selection for faint arms, dust, and halo. Color line gains are zero. |
| **Broadband / reflection** | Hybrid luminance/color selection with restrained color gains. |
| **Veil reference style** | Stronger overall tone and color modeled from the supplied original/edited Veil pair and adapted to the selected image's RGB quantiles. |
| **Exact Guide** | Every pointwise equation and default threshold/gain from the supplied Veil guide, with raw RGB selection and neutral tone. |
| **Custom** | Keeps current mask behavior and lets all controls be tuned. |

Luminance band, bright protection, chroma and red/cyan gates, and gain scale are derived from up to 60,000 spatial image samples. For tone, each channel's 5th, 50th, and 95th percentiles adjust the measured Veil color technique. Presets use 3×3 RGB averaging for noise-resistant color selection and limit gain near white. Exact Guide retains original raw-pixel formulas. Image content cannot reliably identify a galaxy or nebula by statistics alone; choose the subject when Auto does not fit.

The image should already be stretched. Linear source images need a normal PixInsight stretch and noise workflow first; the automatic tone transfer is not a substitute for those steps. Red/cyan gates are color proxies, not calibrated Hα/OIII measurements. Preview before/after uses the source display transformation, when available, for a fair comparison.

## Guide formula and diagnostic masks

The guide luminance is `Y = 0.2126R + 0.7152G + 0.0722B`. Its faint gate is `S(faintStart,faintFull,Y) × [1 − S(faintFade,protectFrom,Y)]`. Chroma is `max(R,G,B) − min(R,G,B)`. The red/cyan selections use `R − (G+B)/2` and its negative. Guide gains multiply the original RGB channels. Exact Guide applies these equations without global tone and creates all seven masks by default.

| Suffix | Meaning |
|---|---|
| `_Faint` | Original-luminance faint gate. |
| `_ColorGate` | RGB chroma gate. |
| `_Ha` | Reddish selection. |
| `_Oiii` | Cyan selection. |
| `_Emission` | Effective enhancement selection. In Galaxy mode this is luminance-based. |
| `_Protected` | Bright protection plus optional exclusion. |
| `_Change` | Maximum predicted RGB channel change, including global tone. |

**Analyze** reports image statistics and coverage; **Masks** creates seven diagnostics without RGB output. Normal Enhance creates one selection mask. Turn on seven-mask output to inspect every component. Use PixInsight's STF to display dark masks. The full-resolution engine reads and writes tiles instead of using per-pixel image APIs.

## Tone, color, and supplied Veil target

Global tone subtracts individual RGB black points, multiplies channel scales, applies channel power curves, then adjusts saturation. The tone sliders set these parameters directly. The quick sliders change their shared average while retaining relative RGB differences. Global tone affects bright pixels even when faint-detail gains are protected.

The supplied `final_print_test.tif` is **8183×12262**; `Veil_selected_faint_Ha_OIII_print_master.tif` is **1024×1536**. Exact Guide changes little on the original because its fixed protection threshold is too low for this stretched source. The target also contains resize and spatial/detail edits outside the guide's equations. The Veil reference preset models its **global** color/tone technique; it cannot recreate every target pixel or infer unseen local edits on arbitrary images. In PixInsight on a matched-size copy, sampled normalized RGB mean absolute error fell from **0.0963** to **0.0695**. The script keeps the source's native dimensions for full output.

For whole-region protection, open a same-size grayscale image, white where faint-detail gains should be blocked. Enter its view ID under **Exclusion mask ID**, or name it `<SourceViewId>_Protect` for automatic detection. Preview downsamples this exclusion mask too. Global tone still affects excluded areas.

Save full results as **32-bit floating-point XISF**. The output copies source FITS keywords and RGB working space, but not an embedded TIFF ICC profile; check the intended print profile before export.

## Installation

Add the repository URL under **Resources → Updates → Manage Repositories → Add**; check for updates, apply, and restart:

```text
https://raw.githubusercontent.com/Jewber11/pixinsight-scripts/main/pixinsight-repository/
```

For immediate local use choose **Script → Execute Script File...** and open `AdaptiveFaintEmission.js`.
