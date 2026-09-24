#include <pjsr/Sizer.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>

#feature-id    Sam's Scripts > Adaptive Faint Emission
#feature-info  GUI for adaptive, exact-guide, and reference-inspired faint emission enhancement.

/*
 * Adaptive Faint Emission for PixInsight/PJSR.
 * Analyze, mask, and enhance from one dialog. Source image is read only.
 * The red/cyan selections are color proxies, not calibrated H-alpha/OIII flux.
 */

var AFE_MAX_ANALYSIS_SAMPLES = 60000;
var AFE_TILE_PIXELS = 300000;

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
   var ys = [], cs = [], ds = [];
   var rows = [ [], [], [], [], [], [], [], [], [] ];
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
         ys.push( yv );
         cs.push( Math.max( sm[0], sm[1], sm[2] ) - Math.min( sm[0], sm[1], sm[2] ) );
         ds.push( Math.abs( sm[0] - 0.5*(sm[1]+sm[2]) ) );
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
   var backgroundC = [], backgroundD = [];
   var skyLimit = afeQuantile( orderedY, 0.45 );
   for ( var i = 0; i < ys.length; ++i )
      if ( ys[i] <= skyLimit )
      {
         backgroundC.push( cs[i] );
         backgroundD.push( ds[i] );
      }
   afeSorted( backgroundC );
   afeSorted( backgroundD );

   var l05 = afeQuantile( orderedY, 0.05 );
   var l25 = afeQuantile( orderedY, 0.25 );
   var l50 = afeQuantile( orderedY, 0.50 );
   var l35 = afeQuantile( orderedY, 0.35 );
   var l65 = afeQuantile( orderedY, 0.65 );
   var l75 = afeQuantile( orderedY, 0.75 );
   var l90 = afeQuantile( orderedY, 0.90 );
   var l999 = afeQuantile( orderedY, 0.999 );
   var l95 = afeQuantile( orderedY, 0.95 );
   var l01 = afeQuantile( orderedY, 0.01 );
   var l99 = afeQuantile( orderedY, 0.99 );
   var skySpread = Math.max( l75-l25, 1e-6 );
   var tail = Math.max( 0, l999-l50 );
   var broadField = skySpread > Math.max( 1e-4, 0.15*(l999-l05) );
   var brightTail = tail > Math.max( 12*skySpread, Math.min( 4*l50, 0.15 ) );
   var le = Math.max( 1e-6, 0.01*skySpread );
   var faintStart = afeClamp( broadField ? l05 : l50+skySpread, 0, 1-3*le );
   var faintFull = afeClamp( Math.max( broadField ? l35 : l50+2.5*skySpread,
                                     faintStart+le ), faintStart+le, 1-2*le );
   // Broad fields use image quantiles; sparse fields use the bright tail.
   var fadeCandidate = broadField ? l65 :
                       (brightTail ? l50+0.25*tail : l50+0.85*tail);
   var protectCandidate = broadField ? l90 :
                          (brightTail ? l50+0.45*tail : l999+4*skySpread);
   var faintFade = afeClamp( Math.max( fadeCandidate, faintFull+le ),
                              faintFull+le, 1-le );
   var protectFrom = afeClamp( Math.max( protectCandidate, faintFade+le ),
                                 faintFade+le, 1 );

   var cStart = afeClamp( afeQuantile( backgroundC, 0.80 ), 0, 1-1e-6 );
   var cFull = afeClamp( Math.max( afeQuantile( backgroundC, 0.98 ),
                                    afeQuantile( orderedC, 0.75 ), cStart+1e-6 ),
                          cStart+1e-6, 1 );
   var dStart = afeClamp( afeQuantile( backgroundD, 0.80 ), 0, 1-1e-6 );
   var dFull = afeClamp( Math.max( afeQuantile( backgroundD, 0.98 ),
                                    afeQuantile( orderedD, 0.75 ), dStart+1e-6 ),
                          dStart+1e-6, 1 );
   // Baseline artistic gains scale down as highlight occupancy increases.
   var gainScale = afeClamp( 1.15-0.6*l95, 0.65, 1.15 );
   return {
      sampleCount: ys.length, p01: l01, p05: l05, p50: l50,
      p95: l95, p99: l99, faintStart: faintStart, faintFull: faintFull,
      faintFade: faintFade, protectFrom: protectFrom,
      chromaStart: cStart, chromaFull: cFull,
      emissionStart: dStart, emissionFull: dFull,
      gainScale: gainScale, brightTail: brightTail, broadField: broadField
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
      faintStart: 0.018, faintFull: 0.045, faintFade: 0.085,
      protectFrom: 0.160, chromaStart: 0.012, chromaFull: 0.070,
      emissionStart: 0.006, emissionFull: 0.055,
      generalGain: 0.220, haRedGain: 0.220, haBlueGain: 0.035,
      oiiiGreenGain: 0.140, oiiiBlueGain: 0.180, strength: 1,
      smoothRGB: false, limitHighlights: false,
      mode: "enhance", makeMasks: true, reportEveryRows: 256,
      exclusionMaskId: "",
      toneBlackR: 0, toneBlackG: 0, toneBlackB: 0,
      toneScaleR: 1, toneScaleG: 1, toneScaleB: 1,
      toneGammaR: 1, toneGammaG: 1, toneGammaB: 1,
      toneSaturation: 1
   };
}
function afeAdaptivePreset( a )
{
   var c = afeGuidePreset();
   c.faintStart = a.faintStart; c.faintFull = a.faintFull;
   c.faintFade = a.faintFade; c.protectFrom = a.protectFrom;
   c.chromaStart = a.chromaStart; c.chromaFull = a.chromaFull;
   c.emissionStart = a.emissionStart; c.emissionFull = a.emissionFull;
   c.generalGain *= a.gainScale; c.haRedGain *= a.gainScale;
   c.haBlueGain *= a.gainScale; c.oiiiGreenGain *= a.gainScale;
   c.oiiiBlueGain *= a.gainScale;
   c.smoothRGB = true; c.limitHighlights = true; c.makeMasks = false;
   return c;
}
function afeReferencePreset( a )
{
   // Fitted to the supplied source/target pair at target size. Approximate.
   var c = afeAdaptivePreset( a );
   c.toneBlackR = 0.038826; c.toneBlackG = 0; c.toneBlackB = 0;
   c.toneScaleR = 1.164268; c.toneScaleG = 1.187431; c.toneScaleB = 1.201743;
   c.toneGammaR = 1.006616; c.toneGammaG = 1.508023; c.toneGammaB = 1.506611;
   c.toneSaturation = 1.111571;
   return c;
}
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
function afeExclusion( sourceView, id )
{
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
      "  global tone=" + afeToneEnabled( c ) );
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
   var exclusion = afeExclusion( sourceView, c.exclusionMaskId );
   console.show(); console.abortEnabled = true;
   console.writeln( "Adaptive Faint Emission | " + sourceView.id +
      " | " + w + "x" + h + " | " + c.mode );
   afeLogParameters( c, a );
   if ( exclusion ) console.writeln( "Exclusion: " +
      (c.exclusionMaskId.length ? c.exclusionMaskId : sourceView.id + "_Protect") );
   var doResult = c.mode === "enhance";
   var fullMasks = c.mode === "masks" || c.makeMasks;
   var names = fullMasks ?
      [ "Faint", "ColorGate", "Ha", "Oiii", "Emission", "Protected", "Change" ] :
      (doResult ? [ "Emission" ] : []);
   var stamp = "AFE_" + (new Date()).getTime();
   var result = null, masks = [], begun = [], completed = false;
   var countProtected = 0, countPotential = 0, countMasked = 0;
   var countChanged = 0, countClipped = 0, countLimited = 0, countToneClipped = 0;
   var toneEnabled = afeToneEnabled( c );
   var sumEmission = 0, maxEmission = 0, maxDelta = 0, maxProtectedDelta = 0;
   try
   {
      for ( var m = 0; m < names.length; ++m )
         masks.push( afeWindow( w, h, 1, stamp + "_" + names[m] ) );
      if ( doResult )
      {
         result = afeWindow( w, h, 3, stamp + "_result" );
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
            if ( !c.limitHighlights && !toneEnabled )
            {
               var outR = [], outG = [], outB = [];
               result.mainView.image.getSamples( outR, writeRect, 0 );
               result.mainView.image.getSamples( outG, writeRect, 1 );
               result.mainView.image.getSamples( outB, writeRect, 2 );
               for ( var pi = 0; pi < n; ++pi )
                  if ( pflags[pi] )
                     maxProtectedDelta = Math.max( maxProtectedDelta,
                        Math.abs( outR[pi]-ro[pi] ),
                        Math.abs( outG[pi]-go[pi] ),
                        Math.abs( outB[pi]-bo[pi] ) );
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
   if ( result ) result.show();
   console.writeln( "Done. Source image unchanged." );
   return { total: total, protectedCount: countProtected, faintCount: countPotential,
      maskedCount: countMasked, changedCount: countChanged, clippedCount: countClipped, toneClippedCount: countToneClipped,
      maxEmission: maxEmission, meanEmission: sumEmission/total, maxDelta: maxDelta };
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
      var raw = Settings.read( "SamAdaptiveFaintEmission/GUI_v3", DataType.UTF16String );
      if ( raw )
      {
         var saved = JSON.parse( raw );
         if ( saved.preset >= 0 && saved.preset <= 3 ) defaults.preset = saved.preset;
         if ( saved.mode >= 0 && saved.mode <= 2 ) defaults.mode = saved.mode;
         defaults.makeMasks = !!saved.makeMasks;
         if ( saved.reportEveryRows >= 0 && saved.reportEveryRows <= 4096 )
            defaults.reportEveryRows = saved.reportEveryRows;
         if ( saved.custom ) defaults.custom = saved.custom;
      }
   }
   catch ( e ) { /* invalid old settings: use defaults */ }
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
         custom: dialog.presetCombo.currentItem === 3 ? dialog.selected.config : dialog.state.custom
      };
      Settings.write( "SamAdaptiveFaintEmission/GUI_v3", DataType.UTF16String,
                      JSON.stringify( state ) );
   }
   catch ( e ) { console.writeln( "NOTICE: GUI settings could not be saved: " + e ); }
}
function afeNumeric( dialog, group, name, labelText, maximum, minimum )
{
   var edit = new NumericEdit( group );
   edit.setReal( true );
   edit.setPrecision( 6 );
   edit.setRange( minimum || 0, maximum );
   edit.enableFixedPrecision( true );
   edit.label.text = labelText;
   edit.label.minWidth = 150;
   edit.edit.setFixedWidth( 92 );
   edit.onValueUpdated = function()
   {
      if ( !dialog.updating ) dialog.markCustom();
   };
   group.sizer.add( edit );
   dialog.fields[name] = edit;
}
function afeGroup( dialog, title )
{
   var group = new GroupBox( dialog );
   group.title = title;
   group.sizer = new VerticalSizer;
   group.sizer.margin = 6;
   group.sizer.spacing = 3;
   return group;
}
function AFEDialog()
{
   this.__base__ = Dialog;
   this.__base__();
   this.windowTitle = "Adaptive Faint Emission";
   this.fields = {};
   this.updating = false;
   this.analysis = null;
   this.analysisId = "";
   this.state = afeLoadState();
   this.selected = null;
   var active = ImageWindow.activeWindow;
   this.sourceView = active && !active.isNull ? active.mainView : null;

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   var intro = new Label( this );
   intro.text = "Analyze, mask, and enhance RGB faint structure. Exact Guide reproduces the supplied equations. Veil target look adds an approximate tone fit to the supplied edit; its different size and detail cannot match exactly.";
   intro.wordWrapping = true;
   this.sizer.add( intro );

   var sourceRow = new HorizontalSizer;
   sourceRow.spacing = 6;
   var sourceLabel = new Label( this );
   sourceLabel.text = "Source RGB:";
   sourceLabel.minWidth = 120;
   sourceLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   sourceRow.add( sourceLabel );
   this.sourceList = new ViewList( this );
   this.sourceList.getMainViews();
   if ( this.sourceView ) this.sourceList.currentView = this.sourceView;
   sourceRow.add( this.sourceList, 100 );
   this.sizer.add( sourceRow );

   var presetRow = new HorizontalSizer;
   presetRow.spacing = 6;
   var presetLabel = new Label( this );
   presetLabel.text = "Recipe:";
   presetLabel.minWidth = 120;
   presetLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   presetRow.add( presetLabel );
   this.presetCombo = new ComboBox( this );
   this.presetCombo.addItem( "Adaptive: image-derived" );
   this.presetCombo.addItem( "Exact Guide: original Veil math" );
   this.presetCombo.addItem( "Veil target look: approximate" );
   this.presetCombo.addItem( "Custom: manual values" );
   this.presetCombo.currentItem = this.state.preset;
   presetRow.add( this.presetCombo, 100 );
   this.sizer.add( presetRow );

   var modeRow = new HorizontalSizer;
   modeRow.spacing = 6;
   var modeLabel = new Label( this );
   modeLabel.text = "Operation:";
   modeLabel.minWidth = 120;
   modeLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   modeRow.add( modeLabel );
   this.modeCombo = new ComboBox( this );
   this.modeCombo.addItem( "Enhance: analyze + mask + RGB result" );
   this.modeCombo.addItem( "Analyze: statistics and optional masks" );
   this.modeCombo.addItem( "Masks: all seven, no RGB result" );
   this.modeCombo.currentItem = this.state.mode;
   modeRow.add( this.modeCombo, 100 );
   this.sizer.add( modeRow );

   this.statusLabel = new Label( this );
   this.statusLabel.text = "Select source, then Analyze Source or Run.";
   this.statusLabel.wordWrapping = true;
   this.sizer.add( this.statusLabel );

   var columns = new HorizontalSizer;
   columns.spacing = 8;
   var left = new VerticalSizer;
   left.spacing = 6;
   var lum = afeGroup( this, "Luminance mask" );
   afeNumeric( this, lum, "faintStart", "Faint start:", 1 );
   afeNumeric( this, lum, "faintFull", "Faint full:", 1 );
   afeNumeric( this, lum, "faintFade", "Faint fade:", 1 );
   afeNumeric( this, lum, "protectFrom", "Protect from:", 1 );
   left.add( lum );
   var color = afeGroup( this, "RGB color mask" );
   afeNumeric( this, color, "chromaStart", "Chroma start:", 1 );
   afeNumeric( this, color, "chromaFull", "Chroma full:", 1 );
   afeNumeric( this, color, "emissionStart", "Red/cyan start:", 1 );
   afeNumeric( this, color, "emissionFull", "Red/cyan full:", 1 );
   left.add( color );
   columns.add( left, 100 );
   var gain = afeGroup( this, "Enhancement gains" );
   afeNumeric( this, gain, "generalGain", "Common RGB:", 5 );
   afeNumeric( this, gain, "haRedGain", "Red in H-alpha:", 5 );
   afeNumeric( this, gain, "haBlueGain", "Blue in H-alpha:", 5 );
   afeNumeric( this, gain, "oiiiGreenGain", "Green in OIII:", 5 );
   afeNumeric( this, gain, "oiiiBlueGain", "Blue in OIII:", 5 );
   afeNumeric( this, gain, "strength", "Overall strength:", 5 );
   columns.add( gain, 100 );
   this.sizer.add( columns );

   var toneRow = new HorizontalSizer;
   toneRow.spacing = 8;
   var toneLevels = afeGroup( this, "Optional RGB background and scale" );
   afeNumeric( this, toneLevels, "toneBlackR", "Red black point:", 1 );
   afeNumeric( this, toneLevels, "toneBlackG", "Green black point:", 1 );
   afeNumeric( this, toneLevels, "toneBlackB", "Blue black point:", 1 );
   afeNumeric( this, toneLevels, "toneScaleR", "Red scale:", 5 );
   afeNumeric( this, toneLevels, "toneScaleG", "Green scale:", 5 );
   afeNumeric( this, toneLevels, "toneScaleB", "Blue scale:", 5 );
   toneRow.add( toneLevels, 100 );
   var toneColor = afeGroup( this, "Optional RGB curve and saturation" );
   afeNumeric( this, toneColor, "toneGammaR", "Red gamma:", 3, 0.1 );
   afeNumeric( this, toneColor, "toneGammaG", "Green gamma:", 3, 0.1 );
   afeNumeric( this, toneColor, "toneGammaB", "Blue gamma:", 3, 0.1 );
   afeNumeric( this, toneColor, "toneSaturation", "Saturation:", 5 );
   toneRow.add( toneColor, 100 );
   this.sizer.add( toneRow );
   var toneNotice = new Label( this );
   toneNotice.text = "Global tone changes all pixels, including pixels protected from faint-emission gains.";
   toneNotice.wordWrapping = true;
   this.sizer.add( toneNotice );

   var options = afeGroup( this, "Mask and output options" );
   this.masksCheck = new CheckBox( options );
   this.masksCheck.text = "Show all seven diagnostic masks (uses more memory)";
   this.masksCheck.checked = this.state.makeMasks;
   options.sizer.add( this.masksCheck );
   this.smoothCheck = new CheckBox( options );
   this.smoothCheck.text = "3x3 RGB averaging for noise-resistant selection";
   options.sizer.add( this.smoothCheck );
   this.headroomCheck = new CheckBox( options );
   this.headroomCheck.text = "Limit gains at highlights instead of clipping";
   options.sizer.add( this.headroomCheck );
   var exclusionRow = new HorizontalSizer;
   exclusionRow.spacing = 6;
   var exclusionLabel = new Label( options );
   exclusionLabel.text = "Exclusion mask ID:";
   exclusionLabel.minWidth = 150;
   exclusionLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   exclusionRow.add( exclusionLabel );
   this.exclusionEdit = new Edit( options );
   this.exclusionEdit.toolTip = "Optional grayscale view ID. Empty auto-detects <SourceViewId>_Protect.";
   exclusionRow.add( this.exclusionEdit, 100 );
   options.sizer.add( exclusionRow );
   var progressRow = new HorizontalSizer;
   progressRow.spacing = 6;
   var progressLabel = new Label( options );
   progressLabel.text = "Progress every rows:";
   progressLabel.minWidth = 150;
   progressLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   progressRow.add( progressLabel );
   this.progressSpin = new SpinBox( options );
   this.progressSpin.minValue = 0;
   this.progressSpin.maxValue = 4096;
   this.progressSpin.value = this.state.reportEveryRows;
   progressRow.add( this.progressSpin );
   progressRow.addStretch();
   options.sizer.add( progressRow );
   this.sizer.add( options );

   var buttons = new HorizontalSizer;
   buttons.spacing = 8;
   var analyzeButton = new PushButton( this );
   analyzeButton.text = "Analyze Source";
   analyzeButton.onClick = function()
   {
      try
      {
         this.dialog.analyze( true );
         if ( this.dialog.presetCombo.currentItem === 0 ||
              this.dialog.presetCombo.currentItem === 2 )
            this.dialog.applyPreset( this.dialog.presetCombo.currentItem );
      }
      catch ( e ) { afeShowError( String( e ) ); }
   };
   buttons.add( analyzeButton );
   buttons.addStretch();
   var runButton = new PushButton( this );
   runButton.text = "Run";
   runButton.defaultButton = true;
   runButton.onClick = function()
   {
      try { this.dialog.selected = this.dialog.collect(); this.dialog.ok(); }
      catch ( e ) { afeShowError( String( e ) ); }
   };
   buttons.add( runButton );
   var cancelButton = new PushButton( this );
   cancelButton.text = "Cancel";
   cancelButton.onClick = function() { this.dialog.cancel(); };
   buttons.add( cancelButton );
   this.sizer.add( buttons );

   var dialog = this;
   this.sourceList.onViewSelected = function( view )
   {
      dialog.sourceView = view;
      dialog.analysis = null;
      dialog.analysisId = "";
      dialog.statusLabel.text = "Source changed. Analyze Source or Run.";
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
   this.updating = false;
};
AFEDialog.prototype.readFields = function()
{
   var c = {};
   for ( var i = 0; i < AFE_FIELDS.length; ++i )
      c[AFE_FIELDS[i]] = this.fields[AFE_FIELDS[i]].value;
   c.smoothRGB = this.smoothCheck.checked;
   c.limitHighlights = this.headroomCheck.checked;
   return c;
};
AFEDialog.prototype.markCustom = function()
{
   this.updating = true;
   this.presetCombo.currentItem = 3;
   this.updating = false;
};
AFEDialog.prototype.analyze = function( force )
{
   var view = this.sourceView;
   afeSource( view );
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
      "; sampled " + this.analysis.sampleCount + " pixels.";
   return this.analysis;
};
AFEDialog.prototype.applyPreset = function( index )
{
   var c;
   if ( index === 0 ) c = afeAdaptivePreset( this.analyze( false ) );
   else if ( index === 1 ) c = afeGuidePreset();
   else if ( index === 2 ) c = afeReferencePreset( this.analyze( false ) );
   else c = this.state.custom || this.readFields();
   this.setFields( c );
   if ( index === 1 ) this.masksCheck.checked = true;
   if ( index === 0 || index === 2 ) this.masksCheck.checked = false;
};
AFEDialog.prototype.collect = function()
{
   var sourceWindow = afeSource( this.sourceView );
   var a = this.analyze( false );
   var preset = this.presetCombo.currentItem;
   var c = preset === 0 ? afeAdaptivePreset( a ) :
           preset === 1 ? afeGuidePreset() :
           preset === 2 ? afeReferencePreset( a ) : this.readFields();
   c.mode = [ "enhance", "analyze", "masks" ][this.modeCombo.currentItem];
   c.makeMasks = this.masksCheck.checked;
   c.reportEveryRows = this.progressSpin.value;
   c.exclusionMaskId = this.exclusionEdit.text.trim();
   afeValidate( c );
   afeExclusion( sourceWindow.mainView, c.exclusionMaskId );
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
