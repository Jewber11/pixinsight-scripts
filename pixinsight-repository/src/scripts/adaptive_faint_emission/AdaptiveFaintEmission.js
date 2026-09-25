#include <pjsr/Sizer.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>

#feature-id    Sam's Scripts > Adaptive Faint Emission
#feature-info  Emission-only adaptive faint-nebulosity enhancement for stretched RGB astrophotography.

/*
 * Adaptive Faint Emission for PixInsight/PJSR.
 * Analyze, mask, and enhance from one dialog. Source image is read only.
 * The red/cyan selections are color proxies, not calibrated H-alpha/OIII flux.
 */

var AFE_MAX_ANALYSIS_SAMPLES = 120000;
var AFE_TILE_PIXELS = 450000;
var AFE_PREVIEW_SUFFIX = "_AFEPreview";

function afeFail( message ) { throw new Error( message ); }
function afeClamp( x, a, b ) { return Math.max( a, Math.min( b, x ) ); }
function afeSmooth( a, b, x )
{
   var t = afeClamp( (x-a)/(b-a), 0, 1 );
   return t*t*(3-2*t);
}
function afeQuantile( values, p )
{
   return values[Math.floor( p*(values.length-1) )];
}
function afeSorted( values )
{
   return values.sort( function( a, b ) { return a-b; } );
}
function afeSampleAnalysis( image )
{
   var w = image.width, h = image.height;
   var stride = Math.max( 1, Math.ceil( Math.sqrt( w*h/AFE_MAX_ANALYSIS_SAMPLES ) ) );
   var ys = [], cs = [], ds = [], channel = [ [], [], [] ];
   var bgChannel = [ [], [], [] ];
   var rows = [ [], [], [], [], [], [], [], [], [] ];
   var redStrength = 0, cyanStrength = 0;
   var redCount = 0, cyanCount = 0;
   var y0 = Math.min( h-1, Math.floor( stride/2 ) );
   for ( var y = y0; y < h; y += stride )
   {
      for ( var c = 0; c < 3; ++c )
         for ( var dy = -1; dy <= 1; ++dy )
         {
            var ry = afeClamp( y+dy, 0, h-1 );
            image.getSamples( rows[3*c+dy+1], new Rect( 0, ry, w, ry+1 ), c );
         }
      var x0 = Math.min( w-1, Math.floor( stride/2 ) );
      for ( var x = x0; x < w; x += stride )
      {
         var yv = 0.2126*rows[1][x] + 0.7152*rows[4][x] + 0.0722*rows[7][x];
         var sm = [ 0, 0, 0 ];
         for ( var ch = 0; ch < 3; ++ch )
         {
            var base = 3*ch;
            for ( var d = 0; d < 3; ++d )
            {
               var row = rows[base+d];
               sm[ch] += row[Math.max( 0, x-1 )] + row[x] + row[Math.min( w-1, x+1 )];
            }
            sm[ch] /= 9;
         }
         var signed = sm[0] - 0.5*(sm[1]+sm[2]);
         ys.push( yv );
         channel[0].push( rows[1][x] );
         channel[1].push( rows[4][x] );
         channel[2].push( rows[7][x] );
         cs.push( Math.max( sm[0], sm[1], sm[2] ) - Math.min( sm[0], sm[1], sm[2] ) );
         ds.push( Math.abs( signed ) );
         if ( signed > 0 )
         {
            redStrength += signed;
            ++redCount;
         }
         else if ( signed < 0 )
         {
            cyanStrength += -signed;
            ++cyanCount;
         }
      }
      if ( (y-y0) % (stride*64) === 0 )
      {
         processEvents();
         if ( console.abortRequested ) afeFail( "Stopped at user's request" );
      }
   }
   if ( ys.length === 0 ) afeFail( "No image samples available" );

   var orderedY = afeSorted( ys.slice( 0 ) );
   var orderedC = afeSorted( cs.slice( 0 ) );
   var orderedD = afeSorted( ds.slice( 0 ) );
   var channelQ = [];
   for ( var ch = 0; ch < 3; ++ch )
   {
      var orderedChannel = afeSorted( channel[ch].slice( 0 ) );
      channelQ.push( { p05: afeQuantile( orderedChannel, 0.05 ),
         p50: afeQuantile( orderedChannel, 0.50 ),
         p95: afeQuantile( orderedChannel, 0.95 ) } );
   }

   var skyLimit = afeQuantile( orderedY, 0.45 );
   var backgroundC = [], backgroundD = [];
   for ( var i = 0; i < ys.length; ++i )
      if ( ys[i] <= skyLimit )
      {
         backgroundC.push( cs[i] );
         backgroundD.push( ds[i] );
         for ( var ch2 = 0; ch2 < 3; ++ch2 )
            bgChannel[ch2].push( channel[ch2][i] );
      }
   if ( backgroundC.length < 32 )
   {
      backgroundC = orderedC.slice( 0, Math.max( 32, Math.floor( 0.45*orderedC.length ) ) );
      backgroundD = orderedD.slice( 0, Math.max( 32, Math.floor( 0.45*orderedD.length ) ) );
      for ( var ch3 = 0; ch3 < 3; ++ch3 )
         bgChannel[ch3] = channel[ch3].slice( 0, Math.max( 32, Math.floor( 0.45*channel[ch3].length ) ) );
   }
   afeSorted( backgroundC );
   afeSorted( backgroundD );
   var bgChannelQ = [];
   for ( var bc = 0; bc < 3; ++bc )
   {
      var orderedBg = afeSorted( bgChannel[bc].slice( 0 ) );
      bgChannelQ.push( { p05: afeQuantile( orderedBg, 0.05 ),
         p50: afeQuantile( orderedBg, 0.50 ),
         p95: afeQuantile( orderedBg, 0.95 ) } );
   }

   var l01 = afeQuantile( orderedY, 0.01 );
   var l05 = afeQuantile( orderedY, 0.05 );
   var l20 = afeQuantile( orderedY, 0.20 );
   var l25 = afeQuantile( orderedY, 0.25 );
   var l35 = afeQuantile( orderedY, 0.35 );
   var l50 = afeQuantile( orderedY, 0.50 );
   var l55 = afeQuantile( orderedY, 0.55 );
   var l65 = afeQuantile( orderedY, 0.65 );
   var l75 = afeQuantile( orderedY, 0.75 );
   var l88 = afeQuantile( orderedY, 0.88 );
   var l95 = afeQuantile( orderedY, 0.95 );
   var l99 = afeQuantile( orderedY, 0.99 );
   var l999 = afeQuantile( orderedY, 0.999 );
   var skySpread = Math.max( l75-l25, 1e-6 );
   var tail = Math.max( 0, l999-l50 );
   var diffuseFactor = afeClamp( (l75-l25)/Math.max( l95-l05, 1e-6 ), 0, 1 );
   var broadField = diffuseFactor > 0.22;
   var brightTail = tail > Math.max( 10*skySpread, Math.min( 3.0*l50, 0.12 ) );
   var le = Math.max( 1e-6, 0.01*skySpread );

   var faintStart = afeClamp( broadField ? l05 : l20, 0, 1-3*le );
   var faintFull = afeClamp( Math.max( broadField ? l20 : l35, faintStart+le ), faintStart+le, 1-2*le );
   var fadeCandidate = broadField ? l55 : (brightTail ? l65 : l75);
   var protectCandidate = broadField ? l88 : (brightTail ? l95 : l99);
   var faintFade = afeClamp( Math.max( fadeCandidate, faintFull+le ), faintFull+le, 1-le );
   var protectFrom = afeClamp( Math.max( protectCandidate, faintFade+le ), faintFade+le, 1 );

   var c50 = afeQuantile( backgroundC, 0.50 );
   var c84 = afeQuantile( backgroundC, 0.84 );
   var c98 = afeQuantile( backgroundC, 0.98 );
   var d50 = afeQuantile( backgroundD, 0.50 );
   var d84 = afeQuantile( backgroundD, 0.84 );
   var d98 = afeQuantile( backgroundD, 0.98 );
   var cNoise = Math.max( c84-c50, 1e-6 );
   var dNoise = Math.max( d84-d50, 1e-6 );

   var cFull = afeClamp( Math.max( c98, afeQuantile( orderedC, 0.60 ), c50+2.5*cNoise ), 1e-6, 0.25 );
   var dFull = afeClamp( Math.max( d98, 0.60*afeQuantile( orderedD, 0.60 ), d50+2.0*dNoise ), 1e-6, 0.12 );

   var biasDen = Math.max( redStrength+cyanStrength, 1e-9 );
   var redBias = redStrength/biasDen;
   var cyanBias = cyanStrength/biasDen;
   var gainScale = afeClamp( 1.10-0.55*l95, 0.60, 1.20 );

   return {
      sampleCount: ys.length, p01: l01, p05: l05, p50: l50,
      p95: l95, p99: l99, faintStart: faintStart, faintFull: faintFull,
      faintFade: faintFade, protectFrom: protectFrom,
      chromaStart: 0, chromaFull: cFull,
      emissionStart: 0, emissionFull: dFull,
      gainScale: gainScale, brightTail: brightTail, broadField: broadField,
      diffuseFactor: diffuseFactor, channelQ: channelQ, bgChannelQ: bgChannelQ,
      redBias: redBias, cyanBias: cyanBias,
      backgroundChromaMedian: c50, backgroundExcessMedian: d50
   };
}

function afeWindow( w, h, channels, id )
{
   return new ImageWindow( w, h, channels, 32, true, channels === 3, id );
}
function afePct( n, total ) { return (100*n/total).toFixed( 3 ) + "%"; }

var AFE_FIELDS = [
   "faintStart", "faintFull", "faintFade", "protectFrom",
   "chromaStart", "chromaFull", "emissionStart", "emissionFull",
   "generalGain", "haRedGain", "haBlueGain", "oiiiGreenGain",
   "oiiiBlueGain", "strength", "toneBlackR", "toneBlackG", "toneBlackB",
   "toneScaleR", "toneScaleG", "toneScaleB", "toneGammaR", "toneGammaG",
   "toneGammaB", "toneSaturation"
];

function afeGuidePreset()
{
   return {
      faintStart: 0.020, faintFull: 0.060, faintFade: 0.120,
      protectFrom: 0.300, chromaStart: 0.000, chromaFull: 0.040,
      emissionStart: 0.000, emissionFull: 0.008,
      generalGain: 0.080, haRedGain: 0.180, haBlueGain: 0.020,
      oiiiGreenGain: 0.080, oiiiBlueGain: 0.140, strength: 1,
      smoothRGB: true, limitHighlights: true,
      mode: "enhance", makeMasks: false, reportEveryRows: 256,
      exclusionMaskId: "", autoExclusion: false, use8BitOutput: false,
      toneBlackR: 0.040, toneBlackG: 0.020, toneBlackB: 0.020,
      toneScaleR: 1.12, toneScaleG: 1.16, toneScaleB: 1.18,
      toneGammaR: 1.02, toneGammaG: 1.22, toneGammaB: 1.26,
      toneSaturation: 1.10, selectionMode: "emission", preview: false,
      outputId: ""
   };
}
function afeAdaptivePreset( a )
{
   var c = afeGuidePreset();
   c.faintStart = a.faintStart;
   c.faintFull = a.faintFull;
   c.faintFade = a.faintFade;
   c.protectFrom = a.protectFrom;
   c.chromaStart = 0;
   c.chromaFull = a.chromaFull;
   c.emissionStart = 0;
   c.emissionFull = a.emissionFull;
   c.generalGain = 0.070*a.gainScale;
   c.haRedGain = 0.170*a.gainScale*(0.80+0.40*a.redBias);
   c.haBlueGain = 0.020*a.gainScale*(0.80+0.40*a.redBias);
   c.oiiiGreenGain = 0.075*a.gainScale*(0.80+0.40*a.cyanBias);
   c.oiiiBlueGain = 0.135*a.gainScale*(0.80+0.40*a.cyanBias);
   c.strength = 1;
   c.smoothRGB = true;
   c.limitHighlights = true;
   c.makeMasks = false;
   c.selectionMode = "emission";
   c.autoExclusion = false;
   c.use8BitOutput = false;
   return c;
}
function afeAutoTone( c, a, profile )
{
   var suffix = [ "R", "G", "B" ];
   for ( var i = 0; i < 3; ++i )
   {
      var q = a.channelQ[i], bg = a.bgChannelQ[i], ch = suffix[i];
      var black = bg.p05 + profile.black*(bg.p50-bg.p05);
      if ( i === 0 )
         black *= 1+0.10*profile.aggression*a.redBias;
      else
         black *= 0.95+0.05*profile.aggression;
      black = afeClamp( black, 0, Math.min( 0.35, q.p50*0.95 ) );

      var highlightRoom = afeClamp( (0.92-q.p95)/0.45, 0, 1.20 );
      var scale = 1+profile.scale*(0.35+0.85*highlightRoom);
      if ( i === 0 ) scale *= 1+0.06*profile.aggression*a.redBias;
      else scale *= 1+0.04*profile.aggression*a.cyanBias;
      scale = afeClamp( scale, 0.70, 2.50 );

      var bgFrac = afeClamp( (q.p50-bg.p50)/Math.max( q.p95-bg.p50, 1e-6 ), 0.05, 0.95 );
      var gamma = i === 0 ?
         0.98+profile.gamma*(0.02+0.10*bgFrac) :
         1.00+profile.gamma*((i === 1 ? 0.26 : 0.30)+0.28*bgFrac);
      gamma = afeClamp( gamma, 0.85, 2.20 );

      c["toneBlack"+ch] = black;
      c["toneScale"+ch] = scale;
      c["toneGamma"+ch] = gamma;
   }
   c.toneSaturation = afeClamp( 1+profile.saturation*(0.12+0.28*a.diffuseFactor), 1.00, 1.80 );
   return c;
}
function afeEmissionPreset( index, a )
{
   var c;
   if ( index === 4 )
      c = afeGuidePreset();
   else
      c = afeAdaptivePreset( a );

   if ( index === 0 ) // balanced
   {
      c.generalGain = 0.070*a.gainScale;
      c.haRedGain = 0.170*a.gainScale*(0.80+0.40*a.redBias);
      c.haBlueGain = 0.020*a.gainScale;
      c.oiiiGreenGain = 0.075*a.gainScale*(0.80+0.40*a.cyanBias);
      c.oiiiBlueGain = 0.135*a.gainScale*(0.80+0.40*a.cyanBias);
      afeAutoTone( c, a, { black: 0.58, scale: 0.32, gamma: 0.85, saturation: 0.75, aggression: 1.00 } );
   }
   if ( index === 1 ) // aggressive faint emission
   {
      c.faintStart = afeClamp( a.faintStart*0.90, 0, a.faintFull-1e-6 );
      c.faintFull = afeClamp( a.faintFull*0.93, c.faintStart+1e-6, a.faintFade-1e-6 );
      c.chromaFull = afeClamp( a.chromaFull*0.85, 1e-6, 0.25 );
      c.emissionFull = afeClamp( a.emissionFull*0.82, 1e-6, 0.12 );
      c.generalGain = 0.100*a.gainScale;
      c.haRedGain = 0.230*a.gainScale*(0.80+0.45*a.redBias);
      c.haBlueGain = 0.030*a.gainScale;
      c.oiiiGreenGain = 0.100*a.gainScale*(0.80+0.45*a.cyanBias);
      c.oiiiBlueGain = 0.170*a.gainScale*(0.80+0.45*a.cyanBias);
      afeAutoTone( c, a, { black: 0.72, scale: 0.44, gamma: 1.05, saturation: 0.95, aggression: 1.25 } );
   }
   if ( index === 2 ) // ultra-aggressive faint emission
   {
      c.faintStart = afeClamp( a.faintStart*0.82, 0, a.faintFull-1e-6 );
      c.faintFull = afeClamp( a.faintFull*0.86, c.faintStart+1e-6, a.faintFade-1e-6 );
      c.faintFade = afeClamp( a.faintFade*0.97, c.faintFull+1e-6, a.protectFrom-1e-6 );
      c.chromaFull = afeClamp( a.chromaFull*0.72, 1e-6, 0.25 );
      c.emissionFull = afeClamp( a.emissionFull*0.68, 1e-6, 0.12 );
      c.generalGain = 0.125*a.gainScale;
      c.haRedGain = 0.285*a.gainScale*(0.82+0.48*a.redBias);
      c.haBlueGain = 0.040*a.gainScale;
      c.oiiiGreenGain = 0.125*a.gainScale*(0.82+0.48*a.cyanBias);
      c.oiiiBlueGain = 0.205*a.gainScale*(0.82+0.48*a.cyanBias);
      afeAutoTone( c, a, { black: 0.84, scale: 0.56, gamma: 1.18, saturation: 1.10, aggression: 1.45 } );
   }
   if ( index === 3 ) // conservative clean
   {
      c.chromaFull = afeClamp( a.chromaFull*1.10, 1e-6, 0.25 );
      c.emissionFull = afeClamp( a.emissionFull*1.12, 1e-6, 0.12 );
      c.generalGain = 0.045*a.gainScale;
      c.haRedGain = 0.120*a.gainScale*(0.85+0.30*a.redBias);
      c.haBlueGain = 0.015*a.gainScale;
      c.oiiiGreenGain = 0.055*a.gainScale*(0.85+0.30*a.cyanBias);
      c.oiiiBlueGain = 0.095*a.gainScale*(0.85+0.30*a.cyanBias);
      afeAutoTone( c, a, { black: 0.46, scale: 0.24, gamma: 0.65, saturation: 0.55, aggression: 0.80 } );
   }
   if ( index === 4 ) // manual emission start point
   {
      afeAutoTone( c, a, { black: 0.52, scale: 0.28, gamma: 0.80, saturation: 0.65, aggression: 0.95 } );
   }
   c.selectionMode = "emission";
   c.smoothRGB = true;
   c.limitHighlights = true;
   c.autoExclusion = false;
   c.use8BitOutput = false;
   return c;
}
function afeReferencePreset( a ) { return afeEmissionPreset( 0, a ); }
function afeValidate( c )
{
   if ( !(0 <= c.faintStart && c.faintStart < c.faintFull &&
           c.faintFull <= c.faintFade && c.faintFade < c.protectFrom &&
           c.protectFrom <= 1) )
      afeFail( "Luminance needs 0 <= start < full <= fade < protect <= 1" );
   if ( !(0 <= c.chromaStart && c.chromaStart < c.chromaFull && c.chromaFull <= 1) )
      afeFail( "Chroma needs 0 <= start < full <= 1" );
   if ( !(0 <= c.emissionStart && c.emissionStart < c.emissionFull && c.emissionFull <= 1) )
      afeFail( "Red/cyan needs 0 <= start < full <= 1" );
   for ( var i = 8; i < 14; ++i )
   {
      var gain = c[AFE_FIELDS[i]];
      if ( !isFinite( gain ) || gain < 0 || gain > 5 )
         afeFail( AFE_FIELDS[i] + " must be between 0 and 5" );
   }
   for ( var bi = 14; bi < 17; ++bi )
      if ( !isFinite( c[AFE_FIELDS[bi]] ) || c[AFE_FIELDS[bi]] < 0 || c[AFE_FIELDS[bi]] > 1 )
         afeFail( AFE_FIELDS[bi] + " must be between 0 and 1" );
   for ( var si = 17; si < 20; ++si )
      if ( !isFinite( c[AFE_FIELDS[si]] ) || c[AFE_FIELDS[si]] < 0 || c[AFE_FIELDS[si]] > 5 )
         afeFail( AFE_FIELDS[si] + " must be between 0 and 5" );
   for ( var gi = 20; gi < 23; ++gi )
      if ( !isFinite( c[AFE_FIELDS[gi]] ) || c[AFE_FIELDS[gi]] < 0.1 || c[AFE_FIELDS[gi]] > 3 )
         afeFail( AFE_FIELDS[gi] + " must be between 0.1 and 3" );
   if ( !isFinite( c.toneSaturation ) || c.toneSaturation < 0 || c.toneSaturation > 5 )
      afeFail( "Tone saturation must be between 0 and 5" );
   if ( c.selectionMode !== "emission" )
      afeFail( "This build is dedicated to emission targets only" );
   if ( c.mode !== "analyze" && c.mode !== "masks" && c.mode !== "enhance" )
      afeFail( "Invalid operation" );
   if ( !isFinite( c.reportEveryRows ) || c.reportEveryRows < 0 )
      afeFail( "Invalid progress interval" );
}
function afeSource( view )
{
   if ( !view || view.isNull || !view.image ) afeFail( "Select an RGB source view" );
   if ( view.id.indexOf( "AFE_" ) === 0 )
      afeFail( "Select the original source, not an AFE result or mask" );
   if ( !view.image.isColor || view.image.numberOfChannels !== 3 )
      afeFail( "Source must have exactly three RGB channels" );
   return view.window;
}
function afeExclusion( sourceView, id, allowAuto )
{
   if ( !id.length && !allowAuto ) return null;
   var maskId = id.length ? id : sourceView.id + "_Protect";
   var window = ImageWindow.windowById( maskId );
   if ( !window || window.isNull )
   {
      if ( id.length ) afeFail( "Exclusion mask view ID not found: " + id );
      return null;
   }
   var mask = window.mainView.image;
   var source = sourceView.image;
   if ( mask.isColor || mask.numberOfChannels !== 1 ||
        mask.width !== source.width || mask.height !== source.height )
      afeFail( "Exclusion mask must be same-size grayscale" );
   return mask;
}
function afeLogParameters( c, a )
{
   console.writeln( "Sampled Y p01/p50/p99=" + a.p01.toFixed( 6 ) + "/" +
      a.p50.toFixed( 6 ) + "/" + a.p99.toFixed( 6 ) );
   console.writeln( "Faint start/full/fade/protect=" +
      c.faintStart.toFixed( 6 ) + "/" + c.faintFull.toFixed( 6 ) + "/" +
      c.faintFade.toFixed( 6 ) + "/" + c.protectFrom.toFixed( 6 ) );
   console.writeln( "Chroma start/full=" + c.chromaStart.toFixed( 6 ) +
      "/" + c.chromaFull.toFixed( 6 ) + "  red/cyan start/full=" +
      c.emissionStart.toFixed( 6 ) + "/" + c.emissionFull.toFixed( 6 ) );
   console.writeln( "RGB smoothing=" + c.smoothRGB +
      "  shared highlight limit=" + c.limitHighlights +
      "  strength=" + c.strength.toFixed( 3 ) +
      "  global tone=" + afeToneEnabled( c ) +
      "  auto exclusion=" + !!c.autoExclusion );
}
function afeToneEnabled( c )
{
   return c.toneBlackR !== 0 || c.toneBlackG !== 0 || c.toneBlackB !== 0 ||
          c.toneScaleR !== 1 || c.toneScaleG !== 1 || c.toneScaleB !== 1 ||
          c.toneGammaR !== 1 || c.toneGammaG !== 1 || c.toneGammaB !== 1 ||
          c.toneSaturation !== 1;
}
function afeRun( sourceWindow, c, a )
{
   afeValidate( c );
   var sourceView = sourceWindow.mainView, source = sourceView.image;
   var w = source.width, h = source.height, total = w*h;
   var exclusion = afeExclusion( sourceView, c.exclusionMaskId, c.autoExclusion );
   var use8BitOutput = !!c.use8BitOutput && c.mode === "enhance" && !c.preview;
   if ( use8BitOutput && source.bitsPerSample !== 8 )
      afeFail( "8-bit reproduction output requires an 8-bit RGB source" );
   console.show(); console.abortEnabled = true;
   console.writeln( "Adaptive Faint Emission | " + sourceView.id +
      " | " + w + "x" + h + " | " + c.mode );
   afeLogParameters( c, a );
   if ( exclusion ) console.writeln( "Exclusion: " +
      (c.exclusionMaskId.length ? c.exclusionMaskId : sourceView.id + "_Protect") );
   var doResult = c.mode === "enhance";
   var fullMasks = !c.preview && (c.mode === "masks" || c.makeMasks);
   var names = c.preview ? [] : fullMasks ?
      [ "Faint", "ColorGate", "Ha", "Oiii", "Emission", "Protected", "Change" ] :
      (doResult ? [ "Emission" ] : []);
   var stamp = "AFE_" + (new Date()).getTime();
   var result = null, masks = [], begun = [], completed = false;
   var countProtected = 0, countPotential = 0, countMasked = 0;
   var countChanged = 0, countChanged8 = 0, maxByteDelta = 0;
   var countClipped = 0, countLimited = 0, countToneClipped = 0;
   var toneEnabled = afeToneEnabled( c );
   var sumEmission = 0, maxEmission = 0, maxDelta = 0, maxProtectedDelta = 0;
   try
   {
      for ( var m = 0; m < names.length; ++m )
         masks.push( afeWindow( w, h, 1, stamp + "_" + names[m] ) );
      if ( doResult )
      {
         var outputId = c.outputId && c.outputId.length ? c.outputId :
            stamp + (c.preview ? "_preview" : "_result");
         result = use8BitOutput ?
            new ImageWindow( w, h, 3, 8, false, true, outputId ) :
            afeWindow( w, h, 3, outputId );
         result.keywords = sourceWindow.keywords;
         result.rgbWorkingSpace = sourceWindow.rgbWorkingSpace;
      }
      for ( var v = 0; v < masks.length; ++v )
      {
         masks[v].mainView.beginProcess( UndoFlag_NoSwapFile );
         begun.push( masks[v].mainView );
      }
      if ( result )
      {
         result.mainView.beginProcess( UndoFlag_NoSwapFile );
         begun.push( result.mainView );
      }
      var tileRows = Math.max( 1, Math.min( 96, Math.floor( AFE_TILE_PIXELS/w ) ) );
      var vr = c.smoothRGB ? new Array( w ) : null;
      var vg = c.smoothRGB ? new Array( w ) : null;
      var vb = c.smoothRGB ? new Array( w ) : null;
      var lastReport = 0;
      for ( var y0 = 0; y0 < h; y0 += tileRows )
      {
         var y1 = Math.min( h, y0+tileRows );
         var readY0 = c.smoothRGB ? Math.max( 0, y0-1 ) : y0;
         var readY1 = c.smoothRGB ? Math.min( h, y1+1 ) : y1;
         var readRect = new Rect( 0, readY0, w, readY1 );
         var writeRect = new Rect( 0, y0, w, y1 );
         var r = [], g = [], b = [], ex = null;
         source.getSamples( r, readRect, 0 );
         source.getSamples( g, readRect, 1 );
         source.getSamples( b, readRect, 2 );
         if ( exclusion )
         {
            ex = [];
            exclusion.getSamples( ex, writeRect, 0 );
         }
         var n = (y1-y0)*w;
         var ro = doResult ? new Array( n ) : null;
         var go = doResult ? new Array( n ) : null;
         var bo = doResult ? new Array( n ) : null;
         var pflags = doResult ? new Array( n ) : null;
         var maskData = [];
         for ( var j = 0; j < names.length; ++j ) maskData.push( new Array( n ) );
         for ( var y = y0; y < y1; ++y )
         {
            var center = (y-readY0)*w;
            var outRow = (y-y0)*w;
            var sr = 0, sg = 0, sb = 0;
            if ( c.smoothRGB )
            {
               var above = (Math.max( 0, y-1 )-readY0)*w;
               var below = (Math.min( h-1, y+1 )-readY0)*w;
               for ( var vx = 0; vx < w; ++vx )
               {
                  vr[vx] = r[above+vx]+r[center+vx]+r[below+vx];
                  vg[vx] = g[above+vx]+g[center+vx]+g[below+vx];
                  vb[vx] = b[above+vx]+b[center+vx]+b[below+vx];
               }
               sr = 2*vr[0]+vr[Math.min( 1, w-1 )];
               sg = 2*vg[0]+vg[Math.min( 1, w-1 )];
               sb = 2*vb[0]+vb[Math.min( 1, w-1 )];
            }
            for ( var x = 0; x < w; ++x )
            {
               var i = outRow+x;
               var R = r[center+x], G = g[center+x], B = b[center+x];
               var Y = 0.2126*R+0.7152*G+0.0722*B;
               var protectedPixel = Y >= c.protectFrom;
               if ( protectedPixel ) ++countProtected;
               if ( pflags ) pflags[i] = protectedPixel;
               var F = protectedPixel ? 0 :
                  afeSmooth( c.faintStart, c.faintFull, Y )*
                  (1-afeSmooth( c.faintFade, c.protectFrom, Y ));
               if ( F > 0 ) ++countPotential;
               var smR = c.smoothRGB ? sr/9 : R;
               var smG = c.smoothRGB ? sg/9 : G;
               var smB = c.smoothRGB ? sb/9 : B;
               var C = Math.max( smR, smG, smB )-Math.min( smR, smG, smB );
               var gate = afeSmooth( c.chromaStart, c.chromaFull, C );
               var d = smR-0.5*(smG+smB);
               var X = ex ? afeClamp( ex[i], 0, 1 ) : 0;
               var commonMask = F*gate*(1-X);
               var H = d > 0 ? commonMask*afeSmooth( c.emissionStart, c.emissionFull, d ) : 0;
               var O = d < 0 ? commonMask*afeSmooth( c.emissionStart, c.emissionFull, -d ) : 0;
               var E = Math.max( H, O );
               if ( E > 0 ) ++countMasked;
               sumEmission += E;
               if ( E > maxEmission ) maxEmission = E;

               var nr = R, ng = G, nb = B;
               if ( !protectedPixel && E > 0 && c.strength > 0 )
               {
                  var q = c.strength;
                  var common = 1+q*c.generalGain*E;
                  var wr = R*common*(1+q*c.haRedGain*H);
                  var wg = G*common*(1+q*c.oiiiGreenGain*O);
                  var wb = B*common*(1+q*c.haBlueGain*H)*(1+q*c.oiiiBlueGain*O);
                  if ( wr > 1 || wg > 1 || wb > 1 ) ++countClipped;
                  if ( c.limitHighlights )
                  {
                     var headroom = 1;
                     if ( wr > R ) headroom = Math.min( headroom, (1-R)/(wr-R) );
                     if ( wg > G ) headroom = Math.min( headroom, (1-G)/(wg-G) );
                     if ( wb > B ) headroom = Math.min( headroom, (1-B)/(wb-B) );
                     headroom = afeClamp( headroom, 0, 1 );
                     if ( headroom < 1 ) ++countLimited;
                     nr = R+headroom*(wr-R);
                     ng = G+headroom*(wg-G);
                     nb = B+headroom*(wb-B);
                  }
                  else
                  {
                     nr = afeClamp( wr, 0, 1 );
                     ng = afeClamp( wg, 0, 1 );
                     nb = afeClamp( wb, 0, 1 );
                  }
               }
               if ( toneEnabled )
               {
                  var tr = Math.pow( afeClamp( (nr-c.toneBlackR)*c.toneScaleR, 0, 1 ), c.toneGammaR );
                  var tg = Math.pow( afeClamp( (ng-c.toneBlackG)*c.toneScaleG, 0, 1 ), c.toneGammaG );
                  var tb = Math.pow( afeClamp( (nb-c.toneBlackB)*c.toneScaleB, 0, 1 ), c.toneGammaB );
                  var toneY = 0.2126*tr+0.7152*tg+0.0722*tb;
                  var toneR = toneY+c.toneSaturation*(tr-toneY);
                  var toneG = toneY+c.toneSaturation*(tg-toneY);
                  var toneB = toneY+c.toneSaturation*(tb-toneY);
                  if ( toneR < 0 || toneG < 0 || toneB < 0 ||
                       toneR > 1 || toneG > 1 || toneB > 1 ) ++countToneClipped;
                  nr = afeClamp( toneR, 0, 1 );
                  ng = afeClamp( toneG, 0, 1 );
                  nb = afeClamp( toneB, 0, 1 );
               }
               // Restore original bright pixels after all faint-detail calculations.
               if ( protectedPixel && !toneEnabled )
               {
                  nr = R; ng = G; nb = B;
               }
               var delta = Math.max( Math.abs( nr-R ), Math.abs( ng-G ), Math.abs( nb-B ) );
               if ( delta > 1e-12 ) ++countChanged;
               if ( delta > maxDelta ) maxDelta = delta;
               if ( doResult ) { ro[i] = nr; go[i] = ng; bo[i] = nb; }
               if ( fullMasks )
               {
                  maskData[0][i] = F; maskData[1][i] = gate;
                  maskData[2][i] = H; maskData[3][i] = O;
                  maskData[4][i] = E; maskData[5][i] = protectedPixel ? 1 : X;
                  maskData[6][i] = delta;
               }
               else if ( maskData.length ) maskData[0][i] = E;
               if ( c.smoothRGB && x+1 < w )
               {
                  var left = Math.max( 0, x-1 ), right = Math.min( w-1, x+2 );
                  sr += vr[right]-vr[left];
                  sg += vg[right]-vg[left];
                  sb += vb[right]-vb[left];
               }
            }
         }
         for ( var mi = 0; mi < masks.length; ++mi )
            masks[mi].mainView.image.setSamples( maskData[mi], writeRect, 0 );
         if ( doResult )
         {
            result.mainView.image.setSamples( ro, writeRect, 0 );
            result.mainView.image.setSamples( go, writeRect, 1 );
            result.mainView.image.setSamples( bo, writeRect, 2 );
            // The original guide audits 32-bit conversion of protected pixels.
            if ( (!c.limitHighlights && !toneEnabled) || use8BitOutput )
            {
               var outR = [], outG = [], outB = [];
               result.mainView.image.getSamples( outR, writeRect, 0 );
               result.mainView.image.getSamples( outG, writeRect, 1 );
               result.mainView.image.getSamples( outB, writeRect, 2 );
               for ( var pi = 0; pi < n; ++pi )
               {
                  if ( pflags[pi] && !c.limitHighlights && !toneEnabled )
                     maxProtectedDelta = Math.max( maxProtectedDelta,
                        Math.abs( outR[pi]-ro[pi] ),
                        Math.abs( outG[pi]-go[pi] ),
                        Math.abs( outB[pi]-bo[pi] ) );
                  if ( use8BitOutput )
                  {
                     var sourceIndex = (Math.floor( pi/w )+y0-readY0)*w+pi%w;
                     var dr = Math.abs( Math.round( 255*outR[pi] )-
                                        Math.round( 255*r[sourceIndex] ) );
                     var dg = Math.abs( Math.round( 255*outG[pi] )-
                                        Math.round( 255*g[sourceIndex] ) );
                     var db = Math.abs( Math.round( 255*outB[pi] )-
                                        Math.round( 255*b[sourceIndex] ) );
                     var byteDelta = Math.max( dr, dg, db );
                     if ( byteDelta > 0 ) ++countChanged8;
                     if ( byteDelta > maxByteDelta ) maxByteDelta = byteDelta;
                  }
               }
            }
         }
         if ( c.reportEveryRows > 0 &&
              (y1-lastReport >= c.reportEveryRows || y1 === h) )
         {
            console.writeln( "Processed " + y1 + "/" + h + " rows" );
            lastReport = y1;
         }
         processEvents();
         if ( console.abortRequested ) afeFail( "Stopped at user's request" );
      }
      completed = true;
   }
   finally
   {
      for ( var k = begun.length-1; k >= 0; --k ) begun[k].endProcess();
      if ( !completed )
      {
         if ( result ) result.forceClose();
         for ( var qx = 0; qx < masks.length; ++qx ) masks[qx].forceClose();
      }
   }
   console.writeln( "Protected=" + afePct( countProtected, total ) +
      "  faint band=" + afePct( countPotential, total ) +
      "  emission=" + afePct( countMasked, total ) +
      "  changed=" + afePct( countChanged, total ) );
   console.writeln( "Max/mean emission=" + maxEmission.toFixed( 6 ) +
      "/" + (sumEmission/total).toFixed( 8 ) +
      "  max RGB change=" + maxDelta.toFixed( 8 ) );
   if ( use8BitOutput )
      console.writeln( "8-bit changed=" + countChanged8 + " (" +
         afePct( countChanged8, total ) + ")  max channel step=" + maxByteDelta );
   console.writeln( "Potential gain clipping=" + countClipped +
      "  highlight-limited=" + countLimited +
      "  tone-clipped=" + countToneClipped );
   if ( doResult && !c.limitHighlights && !toneEnabled )
   {
      console.writeln( "Max protected conversion difference=" +
         maxProtectedDelta.toExponential( 3 ) );
      if ( maxProtectedDelta > 1e-6 )
         afeFail( "Protected pixels changed more than float conversion tolerance" );
   }
   if ( countProtected > 0.95*total )
      console.writeln( "NOTICE: >95% protected; thresholds may not match this image." );
   for ( var show = 0; show < masks.length; ++show ) masks[show].show();
   if ( result && !c.preview ) result.show();
   console.writeln( "Done. Source image unchanged." );
   return { total: total, protectedCount: countProtected, faintCount: countPotential,
      maskedCount: countMasked, changedCount: countChanged, changed8Count: countChanged8,
      maxByteDelta: maxByteDelta, clippedCount: countClipped, toneClippedCount: countToneClipped,
      maxEmission: maxEmission, meanEmission: sumEmission/total, maxDelta: maxDelta,
      resultWindow: result };
}
// Sparse four-point area sample: bounded memory even for a 100 MP source.
function afeDownsampleImage( image, maxEdge, id )
{
   var scale = Math.min( 1, maxEdge/Math.max( image.width, image.height ) );
   var w = Math.max( 1, Math.round( image.width*scale ) );
   var h = Math.max( 1, Math.round( image.height*scale ) );
   var channels = image.numberOfChannels;
   var window = afeWindow( w, h, channels, id );
   var completed = false;
   window.mainView.beginProcess( UndoFlag_NoSwapFile );
   try
   {
      for ( var y = 0; y < h; ++y )
      {
         var sy0 = Math.min( image.height-1, Math.floor( (y+0.25)*image.height/h ) );
         var sy1 = Math.min( image.height-1, Math.floor( (y+0.75)*image.height/h ) );
         for ( var c = 0; c < channels; ++c )
         {
            var row0 = [], row1 = [], out = new Array( w );
            image.getSamples( row0, new Rect( 0, sy0, image.width, sy0+1 ), c );
            if ( sy1 === sy0 ) row1 = row0;
            else image.getSamples( row1, new Rect( 0, sy1, image.width, sy1+1 ), c );
            for ( var x = 0; x < w; ++x )
            {
               var sx0 = Math.min( image.width-1, Math.floor( (x+0.25)*image.width/w ) );
               var sx1 = Math.min( image.width-1, Math.floor( (x+0.75)*image.width/w ) );
               out[x] = 0.25*(row0[sx0]+row0[sx1]+row1[sx0]+row1[sx1]);
            }
            window.mainView.image.setSamples( out, new Rect( 0, y, w, y+1 ), c );
         }
         if ( y % 64 === 0 )
         {
            processEvents();
            if ( console.abortRequested ) afeFail( "Stopped at user's request" );
         }
      }
      completed = true;
   }
   finally
   {
      window.mainView.endProcess();
      if ( !completed ) window.forceClose();
   }
   return window;
}
function afeRenderThumbPreview( selection )
{
   var sourceWindow = selection.sourceWindow;
   var source = null, mask = null, result = null;
   var originalMask = afeExclusion( sourceWindow.mainView,
                                    selection.config.exclusionMaskId,
                                    selection.config.autoExclusion );
   var stamp = "AFE_tmp_" + (new Date()).getTime();
   try
   {
      source = afeDownsampleImage( sourceWindow.mainView.image, 1200,
                                   stamp + "_source" );
      var before = source.mainView.image.render();
      try { sourceWindow.applyColorTransformation( before ); }
      catch ( ignored ) { /* no active STF */ }
      if ( originalMask )
         mask = afeDownsampleImage( originalMask, 1200, stamp + "_mask" );
      var c = {};
      for ( var key in selection.config )
         if ( selection.config.hasOwnProperty( key ) ) c[key] = selection.config[key];
      c.mode = "enhance"; c.makeMasks = false; c.preview = true;
      c.use8BitOutput = false; c.autoExclusion = false;
      c.reportEveryRows = 0;
      c.exclusionMaskId = mask ? mask.mainView.id : "";
      result = afeRun( source, c, selection.analysis ).resultWindow;
      var after = result.mainView.image.render();
      try { sourceWindow.applyColorTransformation( after ); }
      catch ( ignored2 ) { /* no active STF */ }
      return { before: before, after: after,
         width: result.mainView.image.width, height: result.mainView.image.height };
   }
   finally
   {
      if ( result ) result.forceClose();
      if ( mask ) mask.forceClose();
      if ( source ) source.forceClose();
   }
}
function afeCloseWindowById( id )
{
   var w = ImageWindow.windowById( id );
   if ( w && !w.isNull ) w.forceClose();
}
function afeCreateFullPreview( selection )
{
   var sourceWindow = selection.sourceWindow;
   var c = {};
   for ( var key in selection.config )
      if ( selection.config.hasOwnProperty( key ) ) c[key] = selection.config[key];
   c.mode = "enhance";
   c.makeMasks = false;
   c.preview = false;
   c.outputId = sourceWindow.mainView.id + AFE_PREVIEW_SUFFIX;
   c.reportEveryRows = Math.max( 0, selection.config.reportEveryRows );
   afeCloseWindowById( c.outputId );
   return afeRun( sourceWindow, c, selection.analysis ).resultWindow;
}
function afeShowError( message )
{
   (new MessageBox( message, "Adaptive Faint Emission", StdIcon_Error, StdButton_Ok )).execute();
}
function afeLoadState()
{
   var defaults = { preset: 0, mode: 0, makeMasks: false,
      reportEveryRows: 256, custom: null };
   try
   {
      var raw = Settings.read( "SamAdaptiveFaintEmission/GUI_v7", DataType.UTF16String );
      if ( raw )
      {
         var saved = JSON.parse( raw );
         if ( saved.preset >= 0 && saved.preset <= 5 ) defaults.preset = saved.preset;
         if ( saved.mode >= 0 && saved.mode <= 2 ) defaults.mode = saved.mode;
         defaults.makeMasks = !!saved.makeMasks;
         if ( saved.reportEveryRows >= 0 && saved.reportEveryRows <= 4096 )
            defaults.reportEveryRows = saved.reportEveryRows;
         if ( saved.custom )
         {
            // Preserve Custom behavior saved by GUI_v4 before these switches existed.
            if ( typeof saved.custom.autoExclusion === "undefined" )
               saved.custom.autoExclusion = true;
            if ( typeof saved.custom.use8BitOutput === "undefined" )
               saved.custom.use8BitOutput = false;
            defaults.custom = saved.custom;
         }
      }
   }
   catch ( ignored ) { /* damaged saved settings: use defaults */ }
   return defaults;
}
function afeSaveState( dialog )
{
   try
   {
      var state = {
         preset: dialog.presetCombo.currentItem,
         mode: dialog.modeCombo.currentItem,
         makeMasks: dialog.masksCheck.checked,
         reportEveryRows: dialog.progressSpin.value,
         custom: dialog.presetCombo.currentItem === 5 ? dialog.selected.config : dialog.state.custom
      };
      Settings.write( "SamAdaptiveFaintEmission/GUI_v7", DataType.UTF16String,
                      JSON.stringify( state ) );
   }
   catch ( e ) { console.writeln( "NOTICE: GUI settings could not be saved: " + e ); }
}
function afeNumeric( dialog, group, name, title, maximum, minimum )
{
   var edit = new NumericEdit( group );
   edit.setReal( true ); edit.setPrecision( 6 );
   edit.setRange( minimum || 0, maximum );
   edit.enableFixedPrecision( true );
   edit.label.text = title; edit.label.minWidth = 125;
   edit.edit.setFixedWidth( 80 );
   edit.onValueUpdated = function() { if ( !dialog.updating ) dialog.markCustom(); };
   group.sizer.add( edit );
   dialog.fields[name] = edit;
}
function afeGroup( parent, title )
{
   var group = new GroupBox( parent );
   group.title = title;
   group.sizer = new VerticalSizer;
   group.sizer.margin = 6;
   group.sizer.spacing = 3;
   return group;
}
function afeSlider( dialog, group, title, low, high, precision, onChange )
{
   var row = new HorizontalSizer;
   row.spacing = 6;
   var label = new Label( group );
   label.text = title; label.minWidth = 110;
   label.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   row.add( label );
   var slider = new Slider( group );
   slider.setRange( 0, 1000 );
   row.add( slider, 100 );
   var readout = new Label( group );
   readout.minWidth = 56;
   readout.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   row.add( readout );
   group.sizer.add( row );
   var widget = {
      value: low,
      setValue: function( v )
      {
         this.value = afeClamp( v, low, high );
         slider.value = Math.round( 1000*(this.value-low)/(high-low) );
         readout.text = this.value.toFixed( precision );
      }
   };
   slider.onValueUpdated = function( raw )
   {
      widget.value = low+(high-low)*raw/1000;
      readout.text = widget.value.toFixed( precision );
      if ( !dialog.updating ) onChange( widget.value );
   };
   return widget;
}
function afeToneSlider( dialog, group, name, label, low, high )
{
   dialog.fields[name] = afeSlider( dialog, group, label, low, high, 3,
      function() { dialog.markCustom(); dialog.syncQuick(); } );
}
function afePreviewPane( parent, title, dialog, field )
{
   var box = afeGroup( parent, title );
   var view = new Control( box );
   view.setFixedSize( 292, 250 );
   view.onPaint = function()
   {
      var g = new Graphics( this );
      g.fillRect( this.boundsRect, new Brush( 0xff101010 ) );
      if ( dialog[field] )
      {
         var bm = dialog[field], factor = Math.min( this.width/bm.width,
                                                    this.height/bm.height );
         var ww = Math.max( 1, Math.round( bm.width*factor ) );
         var hh = Math.max( 1, Math.round( bm.height*factor ) );
         var x = Math.floor( (this.width-ww)/2 );
         var y = Math.floor( (this.height-hh)/2 );
         g.drawScaledBitmap( new Rect( x, y, x+ww, y+hh ), bm );
      }
      g.end();
   };
   box.sizer.add( view );
   return { box: box, view: view };
}
function AFEDialog()
{
   this.__base__ = Dialog; this.__base__();
   this.windowTitle = "Adaptive Faint Emission";
   this.fields = {}; this.quick = {}; this.updating = false;
   this.analysis = null; this.analysisId = ""; this.configSourceId = "";
   this.currentSelectionMode = "emission";
   this.beforeBitmap = null; this.afterBitmap = null;
   this.state = afeLoadState(); this.selected = null;
   var active = ImageWindow.activeWindow;
   this.sourceView = active && !active.isNull ? active.mainView : null;
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8; this.sizer.spacing = 6;

   var sourceRow = new HorizontalSizer; sourceRow.spacing = 6;
   var sourceLabel = new Label( this );
   sourceLabel.text = "RGB image:"; sourceLabel.minWidth = 110;
   sourceLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   sourceRow.add( sourceLabel );
   this.sourceList = new ViewList( this );
   this.sourceList.getMainViews();
   if ( this.sourceView ) this.sourceList.currentView = this.sourceView;
   sourceRow.add( this.sourceList, 100 ); this.sizer.add( sourceRow );

   var presetRow = new HorizontalSizer; presetRow.spacing = 6;
   var presetLabel = new Label( this );
   presetLabel.text = "Subject:"; presetLabel.minWidth = 110;
   presetLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   presetRow.add( presetLabel );
   this.presetCombo = new ComboBox( this );
   this.presetCombo.addItem( "Auto · balanced emission detail" );
   this.presetCombo.addItem( "Auto · aggressive faint emission" );
   this.presetCombo.addItem( "Auto · ultra-aggressive faint emission" );
   this.presetCombo.addItem( "Auto · conservative clean emission" );
   this.presetCombo.addItem( "Base defaults · manual emission start" );
   this.presetCombo.addItem( "Custom · fine tuning" );
   this.presetCombo.currentItem = this.state.preset;
   presetRow.add( this.presetCombo, 100 ); this.sizer.add( presetRow );

   this.statusLabel = new Label( this );
   this.statusLabel.text = "Select a stretched RGB emission-target image. Auto values are derived from the image itself.";
   this.statusLabel.wordWrapping = true; this.sizer.add( this.statusLabel );
   this.tabs = new TabBox( this );
   this.sizer.add( this.tabs, 100 );

   var quickPage = new Control( this.tabs );
   quickPage.sizer = new VerticalSizer;
   quickPage.sizer.margin = 6; quickPage.sizer.spacing = 5;
   var quickGroup = afeGroup( quickPage, "Fast adjustments · drag sliders, then Preview" );
   var dialog = this;
   this.quick.strength = afeSlider( this, quickGroup, "Faint detail", 0, 5, 2,
      function(v) { dialog.fields.strength.setValue(v); dialog.markCustom(); } );
   this.quick.black = afeSlider( this, quickGroup, "Shadows", 0, 1, 3,
      function(v) { dialog.shiftTone( "toneBlack", v, 0, 1 ); } );
   this.quick.scale = afeSlider( this, quickGroup, "Highlights", 0, 5, 2,
      function(v) { dialog.shiftTone( "toneScale", v, 0, 5 ); } );
   this.quick.gamma = afeSlider( this, quickGroup, "Midtone curve", 0.2, 3, 2,
      function(v) { dialog.shiftTone( "toneGamma", v, 0.1, 3 ); } );
   this.quick.saturation = afeSlider( this, quickGroup, "Color", 0, 5, 2,
      function(v) { dialog.fields.toneSaturation.setValue(v); dialog.markCustom(); } );
   quickPage.sizer.add( quickGroup );
   var note = new Label( quickPage );
   note.text = "Auto is derived from the stretched image itself and is dedicated to emission targets. Preview opens a full-size preview window and also updates the small thumbnails. The preset dropdown now includes an ultra-aggressive mode for very faint nebulosity.";
   note.wordWrapping = true; quickPage.sizer.add( note );
   var previewRow = new HorizontalSizer; previewRow.spacing = 6;
   var before = afePreviewPane( quickPage, "Before", this, "beforeBitmap" );
   var after = afePreviewPane( quickPage, "After", this, "afterBitmap" );
   this.beforeControl = before.view; this.afterControl = after.view;
   previewRow.add( before.box ); previewRow.add( after.box );
   quickPage.sizer.add( previewRow );
   this.tabs.addPage( quickPage, "Quick + preview" );

   var maskPage = new Control( this.tabs );
   maskPage.sizer = new HorizontalSizer;
   maskPage.sizer.margin = 6; maskPage.sizer.spacing = 8;
   var maskLeft = new VerticalSizer; maskLeft.spacing = 6;
   var lum = afeGroup( maskPage, "Luminance band" );
   afeNumeric( this, lum, "faintStart", "Faint start", 1 );
   afeNumeric( this, lum, "faintFull", "Faint full", 1 );
   afeNumeric( this, lum, "faintFade", "Faint fade", 1 );
   afeNumeric( this, lum, "protectFrom", "Protect from", 1 );
   maskLeft.add( lum );
   var color = afeGroup( maskPage, "Color selection" );
   afeNumeric( this, color, "chromaStart", "Chroma start", 1 );
   afeNumeric( this, color, "chromaFull", "Chroma full", 1 );
   afeNumeric( this, color, "emissionStart", "Red/cyan start", 1 );
   afeNumeric( this, color, "emissionFull", "Red/cyan full", 1 );
   maskLeft.add( color ); maskPage.sizer.add( maskLeft, 100 );
   var gain = afeGroup( maskPage, "Enhancement gains" );
   var selectionRow = new HorizontalSizer; selectionRow.spacing = 6;
   var selectionLabel = new Label( gain );
   selectionLabel.text = "Selection:"; selectionLabel.minWidth = 125;
   selectionLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   selectionRow.add( selectionLabel );
   this.selectionCombo = new ComboBox( gain );
   this.selectionCombo.addItem( "Emission only · adaptive red/cyan" );
   selectionRow.add( this.selectionCombo, 100 );
   gain.sizer.add( selectionRow );
   afeNumeric( this, gain, "generalGain", "Common RGB", 5 );
   afeNumeric( this, gain, "haRedGain", "Red in Hα", 5 );
   afeNumeric( this, gain, "haBlueGain", "Blue in Hα", 5 );
   afeNumeric( this, gain, "oiiiGreenGain", "Green in OIII", 5 );
   afeNumeric( this, gain, "oiiiBlueGain", "Blue in OIII", 5 );
   afeNumeric( this, gain, "strength", "Overall strength", 5 );
   maskPage.sizer.add( gain, 100 );
   this.tabs.addPage( maskPage, "Masks + gains" );

   var tonePage = new Control( this.tabs );
   tonePage.sizer = new HorizontalSizer;
   tonePage.sizer.margin = 6; tonePage.sizer.spacing = 8;
   var levels = afeGroup( tonePage, "Shadows and highlights" );
   afeToneSlider( this, levels, "toneBlackR", "Red black", 0, 1 );
   afeToneSlider( this, levels, "toneBlackG", "Green black", 0, 1 );
   afeToneSlider( this, levels, "toneBlackB", "Blue black", 0, 1 );
   afeToneSlider( this, levels, "toneScaleR", "Red scale", 0, 5 );
   afeToneSlider( this, levels, "toneScaleG", "Green scale", 0, 5 );
   afeToneSlider( this, levels, "toneScaleB", "Blue scale", 0, 5 );
   tonePage.sizer.add( levels, 100 );
   var curves = afeGroup( tonePage, "Curves and color" );
   afeToneSlider( this, curves, "toneGammaR", "Red curve", 0.1, 3 );
   afeToneSlider( this, curves, "toneGammaG", "Green curve", 0.1, 3 );
   afeToneSlider( this, curves, "toneGammaB", "Blue curve", 0.1, 3 );
   afeToneSlider( this, curves, "toneSaturation", "Saturation", 0, 5 );
   tonePage.sizer.add( curves, 100 );
   this.tabs.addPage( tonePage, "Tone + color" );

   var outputPage = new Control( this.tabs );
   outputPage.sizer = new VerticalSizer;
   outputPage.sizer.margin = 6; outputPage.sizer.spacing = 6;
   var output = afeGroup( outputPage, "Output" );
   var modeRow = new HorizontalSizer; modeRow.spacing = 6;
   var modeLabel = new Label( output );
   modeLabel.text = "Operation:"; modeLabel.minWidth = 120;
   modeLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   modeRow.add( modeLabel );
   this.modeCombo = new ComboBox( output );
   this.modeCombo.addItem( "Enhance RGB + emission mask" );
   this.modeCombo.addItem( "Analyze image only" );
   this.modeCombo.addItem( "Seven diagnostic masks" );
   this.modeCombo.currentItem = this.state.mode;
   modeRow.add( this.modeCombo, 100 ); output.sizer.add( modeRow );
   this.masksCheck = new CheckBox( output );
   this.masksCheck.text = "Also create seven diagnostic masks";
   this.masksCheck.checked = this.state.makeMasks;
   output.sizer.add( this.masksCheck );
   this.smoothCheck = new CheckBox( output );
   this.smoothCheck.text = "3×3 RGB smoothing for color selection";
   output.sizer.add( this.smoothCheck );
   this.autoExclusionCheck = new CheckBox( output );
   this.autoExclusionCheck.text = "Auto-detect <SourceViewId>_Protect";
   output.sizer.add( this.autoExclusionCheck );
   this.headroomCheck = new CheckBox( output );
   this.headroomCheck.text = "Protect highlight headroom";
   output.sizer.add( this.headroomCheck );
   var exclusionRow = new HorizontalSizer; exclusionRow.spacing = 6;
   var exclusionLabel = new Label( output );
   exclusionLabel.text = "Exclusion mask ID:";
   exclusionLabel.minWidth = 120;
   exclusionLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   exclusionRow.add( exclusionLabel );
   this.exclusionEdit = new Edit( output );
   this.exclusionEdit.toolTip = "Empty auto-detects <SourceViewId>_Protect.";
   exclusionRow.add( this.exclusionEdit, 100 );
   output.sizer.add( exclusionRow );
   var progressRow = new HorizontalSizer; progressRow.spacing = 6;
   var progressLabel = new Label( output );
   progressLabel.text = "Progress rows:"; progressLabel.minWidth = 120;
   progressLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   progressRow.add( progressLabel );
   this.progressSpin = new SpinBox( output );
   this.progressSpin.minValue = 0; this.progressSpin.maxValue = 4096;
   this.progressSpin.value = this.state.reportEveryRows;
   progressRow.add( this.progressSpin ); progressRow.addStretch();
   output.sizer.add( progressRow );
   outputPage.sizer.add( output ); outputPage.sizer.addStretch();
   this.tabs.addPage( outputPage, "Output" );

   var buttons = new HorizontalSizer; buttons.spacing = 8;
   var analyzeButton = new PushButton( this );
   analyzeButton.text = "Analyze + reset defaults";
   analyzeButton.onClick = function()
   {
      try
      {
         dialog.analyze( true );
         dialog.applyPreset( dialog.presetCombo.currentItem === 5 ? 0 :
                             dialog.presetCombo.currentItem );
      }
      catch ( e ) { afeShowError( String( e ) ); }
   };
   buttons.add( analyzeButton );
   var previewButton = new PushButton( this );
   previewButton.text = "Full-size preview";
   previewButton.onClick = function()
   {
      try
      {
         dialog.statusLabel.text = "Making full-size preview…";
         processEvents();
         var sel = dialog.collect();
         var previewWindow = afeCreateFullPreview( sel );
         var pair = afeRenderThumbPreview( sel );
         dialog.beforeBitmap = pair.before; dialog.afterBitmap = pair.after;
         dialog.beforeControl.update(); dialog.afterControl.update();
         dialog.tabs.currentPageIndex = 0;
         dialog.statusLabel.text = "Preview window: " + previewWindow.mainView.id +
            " (" + previewWindow.mainView.image.width + "×" + previewWindow.mainView.image.height + ").";
      }
      catch ( e ) { afeShowError( String( e ) ); }
   };
   buttons.add( previewButton ); buttons.addStretch();
   var runButton = new PushButton( this );
   runButton.text = "Enhance full image"; runButton.defaultButton = true;
   runButton.onClick = function()
   {
      try { dialog.selected = dialog.collect(); dialog.ok(); }
      catch ( e ) { afeShowError( String( e ) ); }
   };
   buttons.add( runButton );
   var cancelButton = new PushButton( this );
   cancelButton.text = "Cancel";
   cancelButton.onClick = function() { dialog.cancel(); };
   buttons.add( cancelButton ); this.sizer.add( buttons );

   this.sourceList.onViewSelected = function( view )
   {
      dialog.sourceView = view; dialog.analysis = null;
      dialog.analysisId = ""; dialog.configSourceId = "";
      dialog.beforeBitmap = null; dialog.afterBitmap = null;
      dialog.beforeControl.update(); dialog.afterControl.update();
      dialog.statusLabel.text = "Source changed. Analyze or preview to recalculate emission defaults.";
   };
   this.presetCombo.onItemSelected = function( index )
   {
      if ( !dialog.updating )
      {
         try { dialog.applyPreset( index ); }
         catch ( e ) { afeShowError( String( e ) ); }
      }
   };
   this.smoothCheck.onCheck = function() { if ( !dialog.updating ) dialog.markCustom(); };
   this.headroomCheck.onCheck = function() { if ( !dialog.updating ) dialog.markCustom(); };
   this.autoExclusionCheck.onCheck = function() { if ( !dialog.updating ) dialog.markCustom(); };
   this.selectionCombo.onItemSelected = function() { if ( !dialog.updating ) dialog.markCustom(); };
   try { this.applyPreset( this.state.preset ); }
   catch ( e )
   {
      this.setFields( this.state.custom || afeGuidePreset() );
      this.statusLabel.text = String( e );
   }
   this.adjustToContents();
}
AFEDialog.prototype = new Dialog;
AFEDialog.prototype.setFields = function( c )
{
   this.updating = true;
   for ( var i = 0; i < AFE_FIELDS.length; ++i )
      this.fields[AFE_FIELDS[i]].setValue( c[AFE_FIELDS[i]] );
   this.smoothCheck.checked = !!c.smoothRGB;
   this.headroomCheck.checked = !!c.limitHighlights;
   this.autoExclusionCheck.checked = !!c.autoExclusion;
   this.currentSelectionMode = "emission";
   this.selectionCombo.currentItem = 0;
   this.selectionCombo.enabled = false;
   this.syncQuick(); this.updating = false;
};
AFEDialog.prototype.syncQuick = function()
{
   var f = this.fields;
   this.updating = true;
   this.quick.strength.setValue( f.strength.value );
   var suffix = [ "R", "G", "B" ];
   var names = [ "black", "scale", "gamma" ];
   var prefix = [ "toneBlack", "toneScale", "toneGamma" ];
   for ( var n = 0; n < names.length; ++n )
   {
      var avg = 0;
      for ( var i = 0; i < 3; ++i ) avg += f[prefix[n]+suffix[i]].value/3;
      this.quick[names[n]].setValue( avg );
   }
   this.quick.saturation.setValue( f.toneSaturation.value );
   this.updating = false;
};
AFEDialog.prototype.shiftTone = function( prefix, requested, low, high )
{
   var suffix = [ "R", "G", "B" ], old = 0;
   for ( var i = 0; i < 3; ++i ) old += this.fields[prefix+suffix[i]].value/3;
   this.updating = true;
   for ( var j = 0; j < 3; ++j )
      this.fields[prefix+suffix[j]].setValue( afeClamp(
         this.fields[prefix+suffix[j]].value+requested-old, low, high ) );
   this.updating = false;
   this.syncQuick(); this.markCustom();
};
AFEDialog.prototype.readFields = function()
{
   var c = {};
   for ( var i = 0; i < AFE_FIELDS.length; ++i )
      c[AFE_FIELDS[i]] = this.fields[AFE_FIELDS[i]].value;
   c.smoothRGB = this.smoothCheck.checked;
   c.limitHighlights = this.headroomCheck.checked;
   c.autoExclusion = this.autoExclusionCheck.checked;
   c.use8BitOutput = false;
   c.selectionMode = "emission";
   return c;
};
AFEDialog.prototype.markCustom = function()
{
   this.updating = true;
   this.presetCombo.currentItem = 5;
   this.updating = false;
};
AFEDialog.prototype.analyze = function( force )
{
   var view = this.sourceView; afeSource( view );
   if ( force || !this.analysis || this.analysisId !== view.id )
   {
      console.show(); console.abortEnabled = true;
      this.analysis = afeSampleAnalysis( view.image );
      this.analysisId = view.id;
   }
   this.statusLabel.text = "Y p01/p50/p99: " +
      this.analysis.p01.toFixed( 5 ) + " / " +
      this.analysis.p50.toFixed( 5 ) + " / " +
      this.analysis.p99.toFixed( 5 ) +
      "; samples: " + this.analysis.sampleCount +
      "; red bias: " + this.analysis.redBias.toFixed( 2 ) +
      "; cyan bias: " + this.analysis.cyanBias.toFixed( 2 ) + ".";
   return this.analysis;
};
AFEDialog.prototype.applyPreset = function( index )
{
   var c = index === 5 ? (this.state.custom || this.readFields()) :
           afeEmissionPreset( index, this.analyze( false ) );
   this.setFields( c );
   this.configSourceId = this.sourceView ? this.sourceView.id : "";
   this.updating = true;
   this.masksCheck.checked = false;
   this.updating = false;
};
AFEDialog.prototype.collect = function()
{
   var sourceWindow = afeSource( this.sourceView );
   var stale = this.configSourceId !== this.sourceView.id;
   var a = this.analyze( false );
   if ( stale && this.presetCombo.currentItem !== 5 )
      this.applyPreset( this.presetCombo.currentItem );
   var c = this.readFields();
   c.mode = [ "enhance", "analyze", "masks" ][this.modeCombo.currentItem];
   c.makeMasks = this.masksCheck.checked;
   c.reportEveryRows = this.progressSpin.value;
   c.exclusionMaskId = this.exclusionEdit.text.trim();
   c.preview = false;
   afeValidate( c );
   afeExclusion( sourceWindow.mainView, c.exclusionMaskId, c.autoExclusion );
   return { sourceWindow: sourceWindow, config: c, analysis: a };
};
function afeMain()
{
   var dialog = new AFEDialog;
   if ( !dialog.execute() ) return;
   afeSaveState( dialog );
   try { afeRun( dialog.selected.sourceWindow, dialog.selected.config,
                 dialog.selected.analysis ); }
   catch ( e ) { afeShowError( String( e ) ); throw e; }
}
afeMain();
