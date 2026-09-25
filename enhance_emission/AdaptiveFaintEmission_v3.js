#include <pjsr/Sizer.jsh>
#include <pjsr/NumericControl.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/Interpolation.jsh>
#include <pjsr/ResizeMode.jsh>

#feature-id    Sam's Scripts > Adaptive Faint Emission
#feature-info  Emission-target-only adaptive nonlinear enhancer with soft tone mapping, palette-independent faint-emission masks, star protection, full-size preview, and optional final downsampling.

/*
 * Adaptive Faint Emission v3.0
 *
 * Intended use:
 *   - RGB emission-target images that have already been stretched/nonlinear.
 *   - Narrowband combinations (HOO/SHO/etc.) and RGB+Ha-style emission images.
 *   - Large TIFF/XISF images, including ASI2600MM Pro integrations.
 *
 * Design goals:
 *   - No hard black clipping in automatic modes.
 *   - Derive luminance, color-distance, and star-protection thresholds from each image.
 *   - Enhance faint colored emission without sharpening or inventing structure.
 *   - Keep processing tiled so full-resolution 26 MP-class images are practical.
 *   - Preserve source pixels spatially at native output resolution.
 *
 * Notes:
 *   - This script does not identify calibrated Ha/OIII/SII flux. It operates on
 *     the colors already present in the stretched RGB image.
 *   - Optional 75%/50% resampling is a presentation step only. Leave output at
 *     native resolution for scientific/pixel-preserving work.
 */

var AFE_VERSION = "3.0";
var AFE_MAX_ANALYSIS_SAMPLES = 120000;
var AFE_TILE_PIXELS = 260000;
var AFE_PREVIEW_SUFFIX = "_AFEPreview";
var AFE_EPS = 1.0e-9;

function afeFail( s ) { throw new Error( s ); }
function afeClamp( x, a, b ) { return Math.max( a, Math.min( b, x ) ); }
function afeSmooth( a, b, x )
{
   if ( b <= a ) return x >= b ? 1 : 0;
   var t = afeClamp( (x-a)/(b-a), 0, 1 );
   return t*t*(3-2*t);
}
function afeSorted( a ) { return a.sort( function( x, y ){ return x-y; } ); }
function afeQuantileSorted( a, p )
{
   if ( a.length === 0 ) return 0;
   return a[Math.floor( afeClamp( p, 0, 1 )*(a.length-1) )];
}
function afeQ( a, p ) { return afeQuantileSorted( a, p ); }
function afeLuminance( r, g, b ) { return 0.2126*r + 0.7152*g + 0.0722*b; }
function afePct( n, total ) { return (100*n/Math.max( total, 1 )).toFixed( 3 ) + "%"; }

function afeWindow( w, h, channels, id )
{
   return new ImageWindow( w, h, channels, 32, true, channels === 3, id );
}

function afeSourceWindow( view )
{
   if ( !view || view.isNull || !view.image ) afeFail( "Select an RGB source image." );
   if ( view.id.indexOf( "AFE_" ) === 0 || view.id.indexOf( AFE_PREVIEW_SUFFIX ) >= 0 )
      afeFail( "Select the original stretched RGB image, not an AFE result." );
   if ( !view.image.isColor || view.image.numberOfChannels !== 3 )
      afeFail( "Source must be a three-channel RGB image." );
   return view.window;
}

/* ------------------------------------------------------------------------- */
/* Analysis                                                                  */
/* ------------------------------------------------------------------------- */

function afeAnalyze( image )
{
   var w = image.width, h = image.height;
   var stride = Math.max( 1, Math.ceil( Math.sqrt( w*h/AFE_MAX_ANALYSIS_SAMPLES ) ) );
   var ys = [], crs = [], cgs = [], cbs = [], localDeltas = [];
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
         var R = rows[1][x], G = rows[4][x], B = rows[7][x];
         var Y = afeLuminance( R, G, B );
         var sm = [0,0,0];
         for ( var ch = 0; ch < 3; ++ch )
         {
            var base = 3*ch;
            for ( var rr = 0; rr < 3; ++rr )
            {
               var row = rows[base+rr];
               sm[ch] += row[Math.max( 0, x-1 )] + row[x] + row[Math.min( w-1, x+1 )];
            }
            sm[ch] /= 9;
         }
         var Ys = afeLuminance( sm[0], sm[1], sm[2] );
         var sum = sm[0]+sm[1]+sm[2];
         if ( sum <= AFE_EPS ) sum = AFE_EPS;
         ys.push( Y );
         crs.push( sm[0]/sum );
         cgs.push( sm[1]/sum );
         cbs.push( sm[2]/sum );
         localDeltas.push( Math.max( Y-Ys, 0 ) );
      }

      if ( (y-y0) % (stride*64) === 0 )
      {
         processEvents();
         if ( console.abortRequested ) afeFail( "Stopped at user's request." );
      }
   }

   if ( ys.length < 64 ) afeFail( "Not enough image samples for adaptive analysis." );

   var orderedY = afeSorted( ys.slice( 0 ) );
   var skyLimit = afeQ( orderedY, 0.45 );
   var bgR = [], bgG = [], bgB = [];
   for ( var i = 0; i < ys.length; ++i )
      if ( ys[i] <= skyLimit )
      {
         bgR.push( crs[i] ); bgG.push( cgs[i] ); bgB.push( cbs[i] );
      }
   afeSorted( bgR ); afeSorted( bgG ); afeSorted( bgB );
   var bgChrom = [ afeQ( bgR, 0.50 ), afeQ( bgG, 0.50 ), afeQ( bgB, 0.50 ) ];

   var distances = [], bgDistances = [];
   var opponent = [], bgOpponent = [];
   var axis = [ 1/Math.sqrt(1.5), -0.5/Math.sqrt(1.5), -0.5/Math.sqrt(1.5) ];
   var totalDev2 = 0, rcProj2 = 0;
   for ( var j = 0; j < ys.length; ++j )
   {
      var dr = crs[j]-bgChrom[0];
      var dg = cgs[j]-bgChrom[1];
      var db = cbs[j]-bgChrom[2];
      var dist = Math.sqrt( dr*dr+dg*dg+db*db );
      var proj = dr*axis[0]+dg*axis[1]+db*axis[2];
      distances.push( dist );
      opponent.push( proj );
      totalDev2 += dist*dist;
      rcProj2 += proj*proj;
      if ( ys[j] <= skyLimit )
      {
         bgDistances.push( dist );
         bgOpponent.push( Math.abs( proj ) );
      }
   }
   afeSorted( distances ); afeSorted( bgDistances );
   afeSorted( localDeltas ); afeSorted( bgOpponent );

   var rcDominance = afeClamp( rcProj2/Math.max( totalDev2, AFE_EPS ), 0, 1 );

   return {
      sampleCount: ys.length,
      orderedY: orderedY,
      orderedDistance: distances,
      orderedBgDistance: bgDistances,
      orderedStarDelta: localDeltas,
      orderedBgOpponent: bgOpponent,
      bgChrom: bgChrom,
      skyLimit: skyLimit,
      rcDominance: rcDominance,
      p01: afeQ( orderedY, 0.01 ),
      p05: afeQ( orderedY, 0.05 ),
      p50: afeQ( orderedY, 0.50 ),
      p95: afeQ( orderedY, 0.95 ),
      p99: afeQ( orderedY, 0.99 )
   };
}

/* ------------------------------------------------------------------------- */
/* Adaptive configuration                                                    */
/* ------------------------------------------------------------------------- */

function afeBaseConfig()
{
   return {
      toneStrength: 1.00,
      detailGain: 0.11,
      emissionSaturation: 0.34,
      globalSaturation: 1.025,
      starProtection: 0.85,
      maskSensitivity: 1.00,
      faintReach: 1.00,
      opponentStrength: 4.5,
      autoOpponent: true,
      makeMasks: false,
      outputScaleMode: 0,
      reportEveryRows: 256,
      exclusionMaskId: "",
      outputId: "",
      preview: false
   };
}

function afePreset( index )
{
   var c = afeBaseConfig();
   if ( index === 1 ) // aggressive
   {
      c.toneStrength = 1.03;
      c.detailGain = 0.16;
      c.emissionSaturation = 0.46;
      c.globalSaturation = 1.030;
      c.starProtection = 0.88;
      c.maskSensitivity = 1.18;
      c.faintReach = 1.12;
      c.opponentStrength = 5.5;
   }
   else if ( index === 2 ) // ultra
   {
      c.toneStrength = 1.07;
      c.detailGain = 0.22;
      c.emissionSaturation = 0.58;
      c.globalSaturation = 1.035;
      c.starProtection = 0.90;
      c.maskSensitivity = 1.36;
      c.faintReach = 1.24;
      c.opponentStrength = 6.5;
   }
   else if ( index === 3 ) // conservative
   {
      c.toneStrength = 0.88;
      c.detailGain = 0.065;
      c.emissionSaturation = 0.22;
      c.globalSaturation = 1.015;
      c.starProtection = 0.92;
      c.maskSensitivity = 0.82;
      c.faintReach = 0.90;
      c.opponentStrength = 3.0;
   }
   return c;
}

function afeDerived( a, c )
{
   var reach = afeClamp( c.faintReach, 0.6, 1.5 );
   var sens = afeClamp( c.maskSensitivity, 0.5, 1.6 );

   var qStart = afeClamp( 0.012/reach, 0.002, 0.05 );
   var qFull = afeClamp( 0.20/Math.sqrt(reach), 0.08, 0.35 );
   var qFade = afeClamp( 0.76+0.08*(reach-1), 0.65, 0.88 );
   var qProtect = afeClamp( 0.970+0.025*(reach-1), 0.93, 0.995 );

   var gateStartP = afeClamp( 0.66-0.33*(sens-1), 0.30, 0.82 );
   var gateFullP = afeClamp( 0.970-0.12*(sens-1), 0.88, 0.995 );

   var faintStart = afeQ( a.orderedY, qStart );
   var faintFull = afeQ( a.orderedY, qFull );
   var faintFade = afeQ( a.orderedY, qFade );
   var protectFrom = afeQ( a.orderedY, qProtect );
   if ( faintFull <= faintStart ) faintFull = faintStart + 1e-6;
   if ( faintFade <= faintFull ) faintFade = faintFull + 1e-6;
   if ( protectFrom <= faintFade ) protectFrom = faintFade + 1e-6;

   var colorStart = afeQ( a.orderedBgDistance, gateStartP );
   var colorFull = afeQ( a.orderedBgDistance, gateFullP );
   if ( colorFull <= colorStart ) colorFull = colorStart + 1e-6;

   var starStart = afeQ( a.orderedStarDelta, 0.970 );
   var starFull = afeQ( a.orderedStarDelta, 0.999 );
   if ( starFull <= starStart ) starFull = starStart + 1e-6;

   var starLumStart = afeQ( a.orderedY, 0.45 );
   var starLumFull = afeQ( a.orderedY, 0.90 );

   return {
      faintStart: faintStart,
      faintFull: faintFull,
      faintFade: faintFade,
      protectFrom: protectFrom,
      colorStart: colorStart,
      colorFull: colorFull,
      starStart: starStart,
      starFull: starFull,
      starLumStart: starLumStart,
      starLumFull: starLumFull
   };
}

/* Tone profile: normalized shape only. Anchor locations come from each image. */
var AFE_TONE_P = [ 0.00, 0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99, 1.00 ];
var AFE_TONE_RATIO = [ 1.00, 0.445, 0.523, 0.658, 0.725, 0.858, 1.095, 1.162, 1.00 ];

function afeToneAnchors( a, c )
{
   var xs = [], ys = [];
   var stretchAdapt = afeClamp( a.p50/0.25, 0.45, 1.20 );
   var strength = c.toneStrength*stretchAdapt;
   for ( var i = 0; i < AFE_TONE_P.length; ++i )
   {
      var x = i === 0 ? 0 : i === AFE_TONE_P.length-1 ? 1 : afeQ( a.orderedY, AFE_TONE_P[i] );
      var ratio = 1 + strength*(AFE_TONE_RATIO[i]-1);
      var y = afeClamp( x*ratio, 0, 1 );
      xs.push( x ); ys.push( y );
   }
   xs[0] = ys[0] = 0; xs[xs.length-1] = ys[ys.length-1] = 1;
   for ( var j = 1; j < ys.length-1; ++j )
      ys[j] = afeClamp( Math.max( ys[j], ys[j-1]+1e-6 ), 0, 1-1e-6 );
   return { x: xs, y: ys };
}

function afeToneMap( x, anchors )
{
   var xs = anchors.x, ys = anchors.y;
   if ( x <= xs[0] ) return ys[0];
   var n = xs.length;
   if ( x >= xs[n-1] ) return ys[n-1];
   var lo = 0, hi = n-1;
   while ( hi-lo > 1 )
   {
      var m = (lo+hi) >> 1;
      if ( x < xs[m] ) hi = m; else lo = m;
   }
   var t = (x-xs[lo])/Math.max( xs[hi]-xs[lo], AFE_EPS );
   /* smooth monotone interpolation; no overshoot and no hard black point */
   t = t*t*(3-2*t);
   return ys[lo] + t*(ys[hi]-ys[lo]);
}

function afeExclusion( sourceView, id )
{
   if ( !id || !id.length ) return null;
   var w = ImageWindow.windowById( id );
   if ( !w || w.isNull ) afeFail( "Exclusion mask not found: " + id );
   var m = w.mainView.image, s = sourceView.image;
   if ( m.isColor || m.numberOfChannels !== 1 || m.width !== s.width || m.height !== s.height )
      afeFail( "Exclusion mask must be same-size grayscale." );
   return m;
}

/* Preserve luminance while changing color separation. */
function afeColorScaleLimit( y, r, g, b, requested )
{
   var s = requested;
   var d = [r-y, g-y, b-y];
   for ( var i = 0; i < 3; ++i )
   {
      if ( d[i] > 0 ) s = Math.min( s, (1-y)/Math.max( d[i], AFE_EPS ) );
      else if ( d[i] < 0 ) s = Math.min( s, y/Math.max( -d[i], AFE_EPS ) );
   }
   return Math.max( 0, s );
}

/* ------------------------------------------------------------------------- */
/* Main tiled processor                                                      */
/* ------------------------------------------------------------------------- */

function afeRun( sourceWindow, c, a )
{
   var sourceView = sourceWindow.mainView, source = sourceView.image;
   var w = source.width, h = source.height, total = w*h;
   var d = afeDerived( a, c );
   var anchors = afeToneAnchors( a, c );
   var exclusion = afeExclusion( sourceView, c.exclusionMaskId );
   var outputId = c.outputId && c.outputId.length ? c.outputId : "AFE_" + (new Date()).getTime() + "_result";
   var result = afeWindow( w, h, 3, outputId );
   result.keywords = sourceWindow.keywords;
   result.rgbWorkingSpace = sourceWindow.rgbWorkingSpace;

   var masks = [];
   var maskNames = c.makeMasks ? ["Faint","Color","Star","Emission","Change"] : [];
   for ( var mi = 0; mi < maskNames.length; ++mi )
      masks.push( afeWindow( w, h, 1, outputId+"_"+maskNames[mi] ) );

   console.show(); console.abortEnabled = true;
   console.writeln( "Adaptive Faint Emission v" + AFE_VERSION + " | " + sourceView.id + " | " + w + "x" + h );
   console.writeln( "Derived luminance start/full/fade/protect=" + d.faintStart.toFixed(6) + "/" + d.faintFull.toFixed(6) + "/" + d.faintFade.toFixed(6) + "/" + d.protectFrom.toFixed(6) );
   console.writeln( "Derived color start/full=" + d.colorStart.toFixed(6) + "/" + d.colorFull.toFixed(6) + "  star start/full=" + d.starStart.toFixed(6) + "/" + d.starFull.toFixed(6) );
   console.writeln( "Background chromaticity=" + a.bgChrom[0].toFixed(5) + "," + a.bgChrom[1].toFixed(5) + "," + a.bgChrom[2].toFixed(5) + "  red/cyan axis dominance=" + a.rcDominance.toFixed(3) );

   var begun = [], completed = false;
   var changed = 0, emissionCount = 0, starCount = 0;
   var sumE = 0, maxE = 0;

   try
   {
      result.mainView.beginProcess( UndoFlag_NoSwapFile ); begun.push( result.mainView );
      for ( var bm = 0; bm < masks.length; ++bm )
      {
         masks[bm].mainView.beginProcess( UndoFlag_NoSwapFile );
         begun.push( masks[bm].mainView );
      }

      var tileRows = Math.max( 1, Math.min( 96, Math.floor( AFE_TILE_PIXELS/w ) ) );
      var vr = new Array( w ), vg = new Array( w ), vb = new Array( w );

      for ( var y0 = 0; y0 < h; y0 += tileRows )
      {
         var y1 = Math.min( h, y0+tileRows );
         var readY0 = Math.max( 0, y0-1 );
         var readY1 = Math.min( h, y1+1 );
         var readRect = new Rect( 0, readY0, w, readY1 );
         var writeRect = new Rect( 0, y0, w, y1 );
         var r = [], g = [], b = [], ex = null;
         source.getSamples( r, readRect, 0 );
         source.getSamples( g, readRect, 1 );
         source.getSamples( b, readRect, 2 );
         if ( exclusion ) { ex = []; exclusion.getSamples( ex, writeRect, 0 ); }

         var n = (y1-y0)*w;
         var ro = new Array( n ), go = new Array( n ), bo = new Array( n );
         var maskData = [];
         for ( var mx = 0; mx < masks.length; ++mx ) maskData.push( new Array( n ) );

         for ( var y = y0; y < y1; ++y )
         {
            var center = (y-readY0)*w;
            var above = (Math.max( 0, y-1 )-readY0)*w;
            var below = (Math.min( h-1, y+1 )-readY0)*w;
            var outRow = (y-y0)*w;

            for ( var vx = 0; vx < w; ++vx )
            {
               vr[vx] = r[above+vx]+r[center+vx]+r[below+vx];
               vg[vx] = g[above+vx]+g[center+vx]+g[below+vx];
               vb[vx] = b[above+vx]+b[center+vx]+b[below+vx];
            }
            var sr = 2*vr[0]+vr[Math.min(1,w-1)];
            var sg = 2*vg[0]+vg[Math.min(1,w-1)];
            var sb = 2*vb[0]+vb[Math.min(1,w-1)];

            for ( var x = 0; x < w; ++x )
            {
               var i = outRow+x;
               var R = r[center+x], G = g[center+x], B = b[center+x];
               var Y = afeLuminance( R, G, B );
               var smR = sr/9, smG = sg/9, smB = sb/9;
               var Ys = afeLuminance( smR, smG, smB );

               var F = afeSmooth( d.faintStart, d.faintFull, Ys ) *
                       (1-afeSmooth( d.faintFade, d.protectFrom, Ys ));

               var sum = smR+smG+smB;
               if ( sum <= AFE_EPS ) sum = AFE_EPS;
               var cR = smR/sum, cG = smG/sum, cB = smB/sum;
               var ddR = cR-a.bgChrom[0], ddG = cG-a.bgChrom[1], ddB = cB-a.bgChrom[2];
               var colorDistance = Math.sqrt( ddR*ddR+ddG*ddG+ddB*ddB );
               var colorGate = afeSmooth( d.colorStart, d.colorFull, colorDistance );

               var localDelta = Math.max( Y-Ys, 0 );
               var star = afeSmooth( d.starStart, d.starFull, localDelta ) *
                          afeSmooth( d.starLumStart, d.starLumFull, Y );
               if ( star > 0.5 ) ++starCount;

               var X = ex ? afeClamp( ex[i], 0, 1 ) : 0;
               var E = F*colorGate*(1-c.starProtection*star)*(1-X);
               E = afeClamp( E, 0, 1 );
               if ( E > 0 ) ++emissionCount;
               sumE += E; if ( E > maxE ) maxE = E;

               /* 1) Smooth monotone global tone map on luminance only. */
               var Yt = afeToneMap( Y, anchors );
               var k = Y > AFE_EPS ? Yt/Y : 0;
               var maxC = Math.max( R, G, B );
               if ( maxC > AFE_EPS && k*maxC > 1 ) k = 1/maxC;
               var tr = R*k, tg = G*k, tb = B*k;
               Yt = afeLuminance( tr, tg, tb );

               /* 2) Faint-emission lightness gain; no sharpening. */
               var Yb = Yt*(1 + c.detailGain*E*(1-Yt));
               var kb = Yt > AFE_EPS ? Yb/Yt : 1;
               tr *= kb; tg *= kb; tb *= kb;
               var maxB = Math.max( tr, tg, tb );
               if ( maxB > 1 ) { tr/=maxB; tg/=maxB; tb/=maxB; }
               Yb = afeLuminance( tr, tg, tb );

               /* 3) Very mild global star/color preservation plus local emission saturation. */
               var requestedSat = c.globalSaturation + c.emissionSaturation*E;
               var allowedSat = afeColorScaleLimit( Yb, tr, tg, tb, requestedSat );
               var nr = Yb + allowedSat*(tr-Yb);
               var ng = Yb + allowedSat*(tg-Yb);
               var nb = Yb + allowedSat*(tb-Yb);

               /*
                * 4) Adaptive red/cyan opponent separation for HOO-like palettes.
                *    The amount is automatically attenuated unless sampled chromatic
                *    variance lies primarily on the red<->cyan axis. This is why the
                *    Veil can get rich red/cyan separation without forcing the same
                *    behavior on arbitrary SHO/RGB emission palettes.
                */
               if ( c.autoOpponent && c.opponentStrength > 0 )
               {
                  var op = nr-0.5*(ng+nb);
                  var oppAuto = afeClamp( (a.rcDominance-0.55)/0.35, 0, 1 );
                  var od = c.opponentStrength*oppAuto*E*op;
                  var rr2 = nr + od;
                  var gg2 = ng - 0.270*od;
                  var bb2 = nb - 0.270*od;
                  var y2 = afeLuminance( rr2, gg2, bb2 );
                  /* small numerical luminance correction */
                  var corr = Yb-y2;
                  rr2 += corr; gg2 += corr; bb2 += corr;
                  nr = afeClamp( rr2, 0, 1 );
                  ng = afeClamp( gg2, 0, 1 );
                  nb = afeClamp( bb2, 0, 1 );
               }

               ro[i] = nr; go[i] = ng; bo[i] = nb;
               var delta = Math.max( Math.abs(nr-R), Math.abs(ng-G), Math.abs(nb-B) );
               if ( delta > 1e-8 ) ++changed;

               if ( masks.length )
               {
                  maskData[0][i] = F;
                  maskData[1][i] = colorGate;
                  maskData[2][i] = star;
                  maskData[3][i] = E;
                  maskData[4][i] = delta;
               }

               if ( x+1 < w )
               {
                  var left = Math.max( 0, x-1 ), right = Math.min( w-1, x+2 );
                  sr += vr[right]-vr[left];
                  sg += vg[right]-vg[left];
                  sb += vb[right]-vb[left];
               }
            }
         }

         result.mainView.image.setSamples( ro, writeRect, 0 );
         result.mainView.image.setSamples( go, writeRect, 1 );
         result.mainView.image.setSamples( bo, writeRect, 2 );
         for ( var mm = 0; mm < masks.length; ++mm )
            masks[mm].mainView.image.setSamples( maskData[mm], writeRect, 0 );

         if ( c.reportEveryRows > 0 && (y1 === h || y1 % c.reportEveryRows < tileRows) )
            console.writeln( "Processed " + y1 + "/" + h + " rows" );
         processEvents();
         if ( console.abortRequested ) afeFail( "Stopped at user's request." );
      }

      for ( var e = begun.length-1; e >= 0; --e ) begun[e].endProcess();
      begun = [];
      completed = true;
   }
   finally
   {
      for ( var ee = begun.length-1; ee >= 0; --ee ) begun[ee].endProcess();
      if ( !completed )
      {
         result.forceClose();
         for ( var fc = 0; fc < masks.length; ++fc ) masks[fc].forceClose();
      }
   }

   console.writeln( "Emission-selected=" + afePct( emissionCount, total ) +
      "  star-protected=" + afePct( starCount, total ) +
      "  changed=" + afePct( changed, total ) +
      "  mean/max emission=" + (sumE/total).toFixed(6) + "/" + maxE.toFixed(6) );

   if ( c.outputScaleMode !== 0 && !c.preview )
   {
      var newW = result.mainView.image.width, newH = result.mainView.image.height;
      if ( c.outputScaleMode === 1 ) { newW = Math.round(newW*0.75); newH = Math.round(newH*0.75); }
      else if ( c.outputScaleMode === 2 ) { newW = Math.round(newW*0.50); newH = Math.round(newH*0.50); }
      else if ( c.outputScaleMode === 3 )
      {
         var longEdge = 1536;
         var sc = longEdge/Math.max( newW, newH );
         if ( sc < 1 ) { newW = Math.round(newW*sc); newH = Math.round(newH*sc); }
      }
      if ( newW !== result.mainView.image.width || newH !== result.mainView.image.height )
      {
         result.mainView.beginProcess( UndoFlag_NoSwapFile );
         result.mainView.image.resample( newW, newH, Interpolation_BicubicBSpline,
                                         ResizeMode_AbsolutePixels,
                                         AbsoluteResizeMode_ForceWidthAndHeight );
         result.mainView.endProcess();
      }
   }

   result.show();
   for ( var sh = 0; sh < masks.length; ++sh ) masks[sh].show();
   return result;
}

/* ------------------------------------------------------------------------- */
/* UI                                                                        */
/* ------------------------------------------------------------------------- */

function afeGroup( parent, title )
{
   var g = new GroupBox( parent );
   g.title = title; g.sizer = new VerticalSizer; g.sizer.margin = 6; g.sizer.spacing = 4;
   return g;
}

function afeSlider( parent, labelText, low, high, precision, initial, callback )
{
   var row = new HorizontalSizer; row.spacing = 6;
   var label = new Label( parent ); label.text = labelText; label.minWidth = 145;
   label.textAlignment = TextAlign_Right | TextAlign_VertCenter; row.add( label );
   var slider = new Slider( parent ); slider.setRange( 0, 1000 ); row.add( slider, 100 );
   var value = new Label( parent ); value.minWidth = 58;
   value.textAlignment = TextAlign_Right | TextAlign_VertCenter; row.add( value );
   var obj = {
      value: initial,
      setValue: function( v )
      {
         this.value = afeClamp( v, low, high );
         slider.value = Math.round( 1000*(this.value-low)/(high-low) );
         value.text = this.value.toFixed( precision );
      }
   };
   slider.onValueUpdated = function( x )
   {
      obj.value = low+(high-low)*x/1000;
      value.text = obj.value.toFixed( precision );
      if ( callback ) callback( obj.value );
   };
   obj.setValue( initial );
   return { row: row, control: obj };
}

function afeLoadState()
{
   var s = { preset:0, outputScaleMode:0, makeMasks:false, custom:null };
   try
   {
      var raw = Settings.read( "SamAdaptiveFaintEmission/GUI_v8", DataType.UTF16String );
      if ( raw )
      {
         var x = JSON.parse( raw );
         if ( x.preset >= 0 && x.preset <= 4 ) s.preset = x.preset;
         if ( x.outputScaleMode >= 0 && x.outputScaleMode <= 3 ) s.outputScaleMode = x.outputScaleMode;
         s.makeMasks = !!x.makeMasks;
         if ( x.custom ) s.custom = x.custom;
      }
   }
   catch ( ignored ) {}
   return s;
}

function afeSaveState( dlg )
{
   try
   {
      Settings.write( "SamAdaptiveFaintEmission/GUI_v8", DataType.UTF16String,
         JSON.stringify( { preset:dlg.presetCombo.currentItem,
                           outputScaleMode:dlg.scaleCombo.currentItem,
                           makeMasks:dlg.masksCheck.checked,
                           custom:dlg.presetCombo.currentItem === 4 ? dlg.readConfig() : dlg.state.custom } ) );
   }
   catch ( ignored ) {}
}

function AFEDialog()
{
   this.__base__ = Dialog; this.__base__();
   this.windowTitle = "Adaptive Faint Emission v" + AFE_VERSION;
   this.state = afeLoadState();
   this.analysis = null; this.analysisId = ""; this.updating = false;
   this.selected = null;
   var active = ImageWindow.activeWindow;
   this.sourceView = active && !active.isNull ? active.mainView : null;

   this.sizer = new VerticalSizer; this.sizer.margin = 8; this.sizer.spacing = 7;

   var srcRow = new HorizontalSizer; srcRow.spacing = 6;
   var srcLabel = new Label( this ); srcLabel.text = "Stretched RGB image:"; srcLabel.minWidth = 145;
   srcLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter; srcRow.add( srcLabel );
   this.sourceList = new ViewList( this ); this.sourceList.getMainViews();
   if ( this.sourceView ) this.sourceList.currentView = this.sourceView;
   srcRow.add( this.sourceList, 100 ); this.sizer.add( srcRow );

   var pRow = new HorizontalSizer; pRow.spacing = 6;
   var pLabel = new Label( this ); pLabel.text = "Emission preset:"; pLabel.minWidth = 145;
   pLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter; pRow.add( pLabel );
   this.presetCombo = new ComboBox( this );
   this.presetCombo.addItem( "Auto · balanced / smooth reference" );
   this.presetCombo.addItem( "Auto · aggressive faint emission" );
   this.presetCombo.addItem( "Auto · ultra-aggressive faint emission" );
   this.presetCombo.addItem( "Auto · conservative clean emission" );
   this.presetCombo.addItem( "Custom · fine tuning" );
   this.presetCombo.currentItem = this.state.preset;
   pRow.add( this.presetCombo, 100 ); this.sizer.add( pRow );

   this.status = new Label( this );
   this.status.text = "Select an already-stretched RGB emission target. Auto parameters are measured from the image.";
   this.status.wordWrapping = true; this.sizer.add( this.status );

   var controls = afeGroup( this, "Adaptive enhancement" );
   var dlg = this;
   var s1 = afeSlider( controls, "Tone strength", 0, 1.5, 2, 1.0, function(){ dlg.markCustom(); } ); controls.sizer.add( s1.row ); this.toneStrength = s1.control;
   var s2 = afeSlider( controls, "Faint brightness", 0, 0.5, 3, 0.11, function(){ dlg.markCustom(); } ); controls.sizer.add( s2.row ); this.detailGain = s2.control;
   var s3 = afeSlider( controls, "Emission color", 0, 1.5, 2, 0.34, function(){ dlg.markCustom(); } ); controls.sizer.add( s3.row ); this.emissionSaturation = s3.control;
   var s4 = afeSlider( controls, "Global/star color", 1.0, 1.20, 3, 1.025, function(){ dlg.markCustom(); } ); controls.sizer.add( s4.row ); this.globalSaturation = s4.control;
   var s5 = afeSlider( controls, "Star protection", 0, 1, 2, 0.85, function(){ dlg.markCustom(); } ); controls.sizer.add( s5.row ); this.starProtection = s5.control;
   var s6 = afeSlider( controls, "Mask sensitivity", 0.5, 1.6, 2, 1.0, function(){ dlg.markCustom(); } ); controls.sizer.add( s6.row ); this.maskSensitivity = s6.control;
   var s7 = afeSlider( controls, "Faint reach", 0.6, 1.5, 2, 1.0, function(){ dlg.markCustom(); } ); controls.sizer.add( s7.row ); this.faintReach = s7.control;
   var s8 = afeSlider( controls, "Red/cyan separation", 0, 8, 2, 4.5, function(){ dlg.markCustom(); } ); controls.sizer.add( s8.row ); this.opponentStrength = s8.control;
   this.sizer.add( controls );

   var opt = afeGroup( this, "Output / diagnostics" );
   this.autoOpponentCheck = new CheckBox( opt );
   this.autoOpponentCheck.text = "Automatically enable red/cyan separation only when the image palette supports it";
   this.autoOpponentCheck.checked = true; opt.sizer.add( this.autoOpponentCheck );
   this.masksCheck = new CheckBox( opt ); this.masksCheck.text = "Create diagnostic masks";
   this.masksCheck.checked = this.state.makeMasks; opt.sizer.add( this.masksCheck );

   var scRow = new HorizontalSizer; scRow.spacing = 6;
   var scLabel = new Label( opt ); scLabel.text = "Final output scale:"; scLabel.minWidth = 145;
   scLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter; scRow.add( scLabel );
   this.scaleCombo = new ComboBox( opt );
   this.scaleCombo.addItem( "Native resolution (recommended)" );
   this.scaleCombo.addItem( "75% after processing (smoother presentation)" );
   this.scaleCombo.addItem( "50% after processing" );
   this.scaleCombo.addItem( "Long edge 1536 px" );
   this.scaleCombo.currentItem = this.state.outputScaleMode; scRow.add( this.scaleCombo, 100 ); opt.sizer.add( scRow );

   var maskRow = new HorizontalSizer; maskRow.spacing = 6;
   var maskLabel = new Label( opt ); maskLabel.text = "Exclusion mask ID:"; maskLabel.minWidth = 145;
   maskLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter; maskRow.add( maskLabel );
   this.exclusionEdit = new Edit( opt ); this.exclusionEdit.toolTip = "Optional same-size grayscale mask; white protects.";
   maskRow.add( this.exclusionEdit, 100 ); opt.sizer.add( maskRow );
   this.sizer.add( opt );

   var note = new Label( this );
   note.text = "The automatic modes never subtract a hard black point. Full-size Preview creates a native-resolution processed window. Optional downsampling happens only after final processing.";
   note.wordWrapping = true; this.sizer.add( note );

   var buttons = new HorizontalSizer; buttons.spacing = 7;
   var analyze = new PushButton( this ); analyze.text = "Analyze";
   analyze.onClick = function(){ try { dlg.doAnalyze( true ); dlg.applyPreset( dlg.presetCombo.currentItem === 4 ? 0 : dlg.presetCombo.currentItem ); } catch(e){ afeError(e); } };
   buttons.add( analyze );
   var preview = new PushButton( this ); preview.text = "Full-size Preview";
   preview.onClick = function()
   {
      try
      {
         var sel = dlg.collect();
         var id = sel.sourceWindow.mainView.id + AFE_PREVIEW_SUFFIX;
         var old = ImageWindow.windowById( id ); if ( old && !old.isNull ) old.forceClose();
         sel.config.outputId = id; sel.config.preview = true; sel.config.outputScaleMode = 0;
         dlg.status.text = "Rendering full-size preview…"; processEvents();
         var w = afeRun( sel.sourceWindow, sel.config, sel.analysis );
         dlg.status.text = "Preview created: " + w.mainView.id + " (" + w.mainView.image.width + "×" + w.mainView.image.height + ").";
      }
      catch(e){ afeError(e); }
   };
   buttons.add( preview ); buttons.addStretch();
   var run = new PushButton( this ); run.text = "Enhance Full Image"; run.defaultButton = true;
   run.onClick = function(){ try { dlg.selected = dlg.collect(); dlg.ok(); } catch(e){ afeError(e); } };
   buttons.add( run );
   var cancel = new PushButton( this ); cancel.text = "Cancel"; cancel.onClick = function(){ dlg.cancel(); }; buttons.add( cancel );
   this.sizer.add( buttons );

   this.sourceList.onViewSelected = function( v )
   {
      dlg.sourceView = v; dlg.analysis = null; dlg.analysisId = "";
      dlg.status.text = "Source changed. Analyze, preview, or run to recalculate adaptive parameters.";
   };
   this.presetCombo.onItemSelected = function( i )
   {
      if ( !dlg.updating ) { try { dlg.applyPreset( i ); } catch(e){ afeError(e); } }
   };
   this.autoOpponentCheck.onCheck = function(){ if (!dlg.updating) dlg.markCustom(); };

   try { this.applyPreset( this.state.preset ); }
   catch ( e ) { this.applyConfig( afeBaseConfig() ); this.status.text = String(e); }
   this.adjustToContents();
}
AFEDialog.prototype = new Dialog;

AFEDialog.prototype.doAnalyze = function( force )
{
   var w = afeSourceWindow( this.sourceView );
   if ( force || !this.analysis || this.analysisId !== this.sourceView.id )
   {
      console.show(); console.abortEnabled = true;
      this.analysis = afeAnalyze( w.mainView.image ); this.analysisId = this.sourceView.id;
   }
   this.status.text = "Y p01/p50/p99: " + this.analysis.p01.toFixed(5) + " / " + this.analysis.p50.toFixed(5) + " / " + this.analysis.p99.toFixed(5) +
      "; samples: " + this.analysis.sampleCount + "; red/cyan palette confidence: " + this.analysis.rcDominance.toFixed(2) + ".";
   return this.analysis;
};

AFEDialog.prototype.applyConfig = function( c )
{
   this.updating = true;
   this.toneStrength.setValue( c.toneStrength );
   this.detailGain.setValue( c.detailGain );
   this.emissionSaturation.setValue( c.emissionSaturation );
   this.globalSaturation.setValue( c.globalSaturation );
   this.starProtection.setValue( c.starProtection );
   this.maskSensitivity.setValue( c.maskSensitivity );
   this.faintReach.setValue( c.faintReach );
   this.opponentStrength.setValue( c.opponentStrength );
   this.autoOpponentCheck.checked = c.autoOpponent !== false;
   this.updating = false;
};

AFEDialog.prototype.applyPreset = function( i )
{
   if ( i === 4 )
   {
      if ( this.state.custom ) this.applyConfig( this.state.custom );
      return;
   }
   this.doAnalyze( false );
   this.applyConfig( afePreset( i ) );
};

AFEDialog.prototype.markCustom = function()
{
   if ( this.updating ) return;
   this.updating = true; this.presetCombo.currentItem = 4; this.updating = false;
};

AFEDialog.prototype.readConfig = function()
{
   var c = afeBaseConfig();
   c.toneStrength = this.toneStrength.value;
   c.detailGain = this.detailGain.value;
   c.emissionSaturation = this.emissionSaturation.value;
   c.globalSaturation = this.globalSaturation.value;
   c.starProtection = this.starProtection.value;
   c.maskSensitivity = this.maskSensitivity.value;
   c.faintReach = this.faintReach.value;
   c.opponentStrength = this.opponentStrength.value;
   c.autoOpponent = this.autoOpponentCheck.checked;
   c.makeMasks = this.masksCheck.checked;
   c.outputScaleMode = this.scaleCombo.currentItem;
   c.exclusionMaskId = this.exclusionEdit.text.trim();
   return c;
};

AFEDialog.prototype.collect = function()
{
   var w = afeSourceWindow( this.sourceView );
   var a = this.doAnalyze( false );
   var c = this.readConfig();
   afeExclusion( w.mainView, c.exclusionMaskId );
   return { sourceWindow:w, config:c, analysis:a };
};

function afeError( e )
{
   (new MessageBox( String(e), "Adaptive Faint Emission", StdIcon_Error, StdButton_Ok )).execute();
}

function main()
{
   var d = new AFEDialog;
   if ( !d.execute() ) return;
   afeSaveState( d );
   try { afeRun( d.selected.sourceWindow, d.selected.config, d.selected.analysis ); }
   catch ( e ) { afeError(e); throw e; }
}

main();
