# Adaptive Faint Emission

Enhance faint detail in an open RGB image with **Script → Sam's Scripts → Adaptive Faint Emission**. Select the source, choose a subject, inspect the before/after preview, adjust sliders, then run at full resolution. The source is unchanged. It creates an RGB result and a selection mask; Exact Guide can emit an 8-bit result when the input is 8-bit.

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

Luminance band, bright protection, chroma and red/cyan gates, and gain scale are derived from up to 60,000 spatial image samples. For tone, each channel's 5th, 50th, and 95th percentiles adjust the measured Veil color technique. Presets use 3×3 RGB averaging for noise-resistant color selection and limit gain near white. Exact Guide retains original raw-pixel formulas, fixed thresholds, no RGB smoothing, no global tone, and no automatic exclusion mask. Image content cannot reliably identify a galaxy or nebula by statistics alone; choose the subject when Auto does not fit.

The image should already be stretched. Linear source images need a normal PixInsight stretch and noise workflow first; the automatic tone transfer is not a substitute for those steps. Red/cyan gates are color proxies, not calibrated Hα/OIII measurements. Preview before/after uses the source display transformation, when available, for a fair comparison.

## Guide formula and diagnostic masks

The guide luminance is `Y = 0.2126R + 0.7152G + 0.0722B`. Its faint gate is `S(faintStart,faintFull,Y) × [1 − S(faintFade,protectFrom,Y)]`. Chroma is `max(R,G,B) − min(R,G,B)`. The red/cyan selections use `R − (G+B)/2` and its negative. Guide gains multiply the original RGB channels. Exact Guide applies these equations without global tone and creates all seven masks by default. It explicitly restores source RGB for every pixel with original `Y ≥ 0.160`. Its default output is 8-bit for an 8-bit source and 32-bit float otherwise. The Output tab can change this choice. The console reports post-rounding changed-pixel count and maximum 8-bit channel step.

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

The supplied `final_print_test.tif` and `final_print_test.jpg` are **8183×12262**; `Veil_selected_faint_Ha_OIII_print_master.tif` is **1024×1536**. The later specification describes a different **1024×1536 8-bit RGB PNG** input that is not available here. Its sample at (136,1) was (34,15,23); the supplied JPG at that coordinate is (66,64,65). The full JPG has **98.777%** of pixels protected by `Y ≥ 0.160` (a 1024×1536 box downscale has **99.885%**), versus the specification’s **59.047%**. The supplied JPG/TIFF cannot certify that PNG’s full-image counts.

A no-ICC synthetic 8-bit PNG test in PixInsight confirmed the sample (34,15,23) → (51,18,29), exact bright-pixel restoration, no implicit exclusion, and post-rounding count reporting. The original guide equation also passed a pixelwise regression test with maximum normalized difference below `5×10⁻⁹`.

Exact Guide changes little on the supplied full-size original because its fixed protection threshold is too low for that stretched source. The edited target also contains resize and spatial/detail edits outside the guide’s equations. The Veil reference preset models its **global** color/tone technique; it cannot recreate every target pixel or infer unseen local edits on arbitrary images. In PixInsight on a matched-size copy, sampled normalized RGB mean absolute error fell from **0.0963** to **0.0695**. Full output keeps the source’s native dimensions.

For whole-region protection, open a same-size grayscale image, white where faint-detail gains should be blocked. Enter its view ID under **Exclusion mask ID**. Other presets can auto-detect `<SourceViewId>_Protect`; Exact Guide leaves that option off so an unnoticed mask cannot change the stated formula. Preview downsamples an active exclusion mask too. Global tone still affects excluded areas in non-Guide presets.

Save non-Guide working results as **32-bit floating-point XISF**. For an 8-bit PNG reproduction, use Exact Guide with **8-bit RGB output**, then export PNG/TIFF without further transformations. The output copies source FITS keywords and RGB working space, but not an embedded TIFF ICC profile; check the intended print profile before export.

## Installation

Add the repository URL under **Resources → Updates → Manage Repositories → Add**; check for updates, apply, and restart:

```text
https://raw.githubusercontent.com/Jewber11/pixinsight-scripts/main/pixinsight-repository/
```

For immediate local use choose **Script → Execute Script File...** and open `AdaptiveFaintEmission.js`.
