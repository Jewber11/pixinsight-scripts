#include <pjsr/UndoFlag.jsh>

#feature-id    Sam's Scripts > Adaptive Faint Emission
#feature-info  Analyze active RGB image, build a noise-aware emission mask, and enhance faint red/cyan structure automatically.

/*
 * Adaptive Faint Emission for PixInsight/PJSR.
 * One run: analyze -> mask -> enhance. Source image is read only.
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
   var l75 = afeQuantile( orderedY, 0.75 );
   var l999 = afeQuantile( orderedY, 0.999 );
   var l95 = afeQuantile( orderedY, 0.95 );
   var skySpread = Math.max( l75-l25, 1e-6 );
   var tail = Math.max( 0, l999-l50 );
   var brightTail = tail > Math.max( 12*skySpread, 4*l50 );
   var le = Math.max( 1e-6, 0.01*skySpread );
   var faintStart = afeClamp( l50+skySpread, 0, 1-3*le );
   var faintFull = afeClamp( Math.max( l50+2.5*skySpread, faintStart+le ),
                              faintStart+le, 1-2*le );
   // A rare bright filament must not push a faint structure out of the mask.
   var fadeCandidate = brightTail ? l50+0.25*tail : l50+0.85*tail;
   var protectCandidate = brightTail ? l50+0.45*tail : l999+4*skySpread;
   var faintFade = afeClamp( Math.max( fadeCandidate, faintFull+le ),
                              faintFull+le, 1-le );
   var protectFrom = afeClamp( Math.max( protectCandidate, faintFade+le ),
                                 faintFade+le, 1 );

   var cStart = afeQuantile( backgroundC, 0.80 );
   var cFull = Math.max( afeQuantile( backgroundC, 0.98 ),
                         afeQuantile( orderedC, 0.75 ), cStart+1e-6 );
   var dStart = afeQuantile( backgroundD, 0.80 );
   var dFull = Math.max( afeQuantile( backgroundD, 0.98 ),
                         afeQuantile( orderedD, 0.75 ), dStart+1e-6 );
   // Baseline artistic gains scale down as highlight occupancy increases.
   var gainScale = afeClamp( 1.15-0.6*l95, 0.65, 1.15 );
   return {
      sampleCount: ys.length, p05: l05, p50: l50,
      p95: l95, faintStart: faintStart, faintFull: faintFull,
      faintFade: faintFade, protectFrom: protectFrom,
      chromaStart: cStart, chromaFull: cFull,
      emissionStart: dStart, emissionFull: dFull,
      gainScale: gainScale, brightTail: brightTail
   };
}

function afeWindow( w, h, channels, id )
{
   return new ImageWindow( w, h, channels, 32, true, channels === 3, id );
}
function afePct( n, total ) { return (100*n/total).toFixed( 3 ) + "%"; }

function afeMain()
{
   var sourceWindow = ImageWindow.activeWindow;
   if ( !sourceWindow || sourceWindow.isNull ) afeFail( "Activate an RGB source image" );
   var sourceView = sourceWindow.mainView;
   if ( sourceView.id.indexOf( "AFE_" ) === 0 )
      afeFail( "Activate the original source, not a previous AFE result or mask" );
   var source = sourceView.image;
   if ( !source.isColor || source.numberOfChannels !== 3 )
      afeFail( "Active image must have exactly three RGB channels" );
   var w = source.width, h = source.height;
   if ( w < 1 || h < 1 ) afeFail( "Empty image" );

   // An optional same-size grayscale image named SourceId_Protect can block a
   // whole bright complex, including its dark gaps. White means preserve.
   var exclusionWindow = ImageWindow.windowById( sourceView.id + "_Protect" );
   var exclusion = null;
   if ( exclusionWindow && !exclusionWindow.isNull )
   {
      exclusion = exclusionWindow.mainView.image;
      if ( exclusion.isColor || exclusion.numberOfChannels !== 1 ||
           exclusion.width !== w || exclusion.height !== h )
         afeFail( sourceView.id + "_Protect must be same-size grayscale" );
   }

   console.show();
   console.abortEnabled = true;
   console.writeln( "Adaptive Faint Emission | " + sourceView.id + " | " + w + "x" + h );
   console.writeln( "Analyzing luminance and spatially averaged RGB..." );
   var a = afeSampleAnalysis( source );
   console.writeln( "Samples=" + a.sampleCount + "  Y p05/p50/p95=" +
      a.p05.toFixed( 6 ) + "/" + a.p50.toFixed( 6 ) + "/" + a.p95.toFixed( 6 ) );
   console.writeln( "Luminance start/full/fade/protect=" +
      a.faintStart.toFixed( 6 ) + "/" + a.faintFull.toFixed( 6 ) + "/" +
      a.faintFade.toFixed( 6 ) + "/" + a.protectFrom.toFixed( 6 ) );
   console.writeln( "RGB chroma start/full=" + a.chromaStart.toFixed( 6 ) +
      "/" + a.chromaFull.toFixed( 6 ) + "  red/cyan start/full=" +
      a.emissionStart.toFixed( 6 ) + "/" + a.emissionFull.toFixed( 6 ) +
      "  gain scale=" + a.gainScale.toFixed( 3 ) +
      "  bright tail=" + a.brightTail );
   if ( exclusion ) console.writeln( "Using protection image: " + sourceView.id + "_Protect" );

   var stamp = "AFE_" + (new Date()).getTime();
   var result = null, mask = null;
   var begun = [];
   var completed = false;
   var protectedCount = 0, maskedCount = 0, changedCount = 0, limitedCount = 0;
   var maxDelta = 0;
   try
   {
      result = afeWindow( w, h, 3, stamp + "_result" );
      mask = afeWindow( w, h, 1, stamp + "_mask" );
      result.keywords = sourceWindow.keywords;
      result.rgbWorkingSpace = sourceWindow.rgbWorkingSpace;
      result.mainView.beginProcess( UndoFlag_NoSwapFile );
      begun.push( result.mainView );
      mask.mainView.beginProcess( UndoFlag_NoSwapFile );
      begun.push( mask.mainView );
      var tileRows = Math.max( 1, Math.min( 96, Math.floor( AFE_TILE_PIXELS/w ) ) );
      var vr = new Array( w ), vg = new Array( w ), vb = new Array( w );
      for ( var y0 = 0; y0 < h; y0 += tileRows )
      {
         var y1 = Math.min( h, y0+tileRows );
         var readY0 = Math.max( 0, y0-1 ), readY1 = Math.min( h, y1+1 );
         var readRect = new Rect( 0, readY0, w, readY1 );
         var r = [], g = [], b = [], ex = null;
         source.getSamples( r, readRect, 0 );
         source.getSamples( g, readRect, 1 );
         source.getSamples( b, readRect, 2 );
         if ( exclusion )
         {
            ex = [];
            exclusion.getSamples( ex, new Rect( 0, y0, w, y1 ), 0 );
         }
         var n = (y1-y0)*w;
         var ro = new Array( n ), go = new Array( n ), bo = new Array( n );
         var mo = new Array( n );
         for ( var y = y0; y < y1; ++y )
         {
            var above = (Math.max( 0, y-1 )-readY0)*w;
            var center = (y-readY0)*w;
            var below = (Math.min( h-1, y+1 )-readY0)*w;
            var outRow = (y-y0)*w;
            for ( var x = 0; x < w; ++x )
            {
               vr[x] = r[above+x]+r[center+x]+r[below+x];
               vg[x] = g[above+x]+g[center+x]+g[below+x];
               vb[x] = b[above+x]+b[center+x]+b[below+x];
            }
            var sr = 2*vr[0]+vr[Math.min( 1, w-1 )];
            var sg = 2*vg[0]+vg[Math.min( 1, w-1 )];
            var sb = 2*vb[0]+vb[Math.min( 1, w-1 )];
            for ( var x = 0; x < w; ++x )
            {
               var i = outRow+x;
               var rr = r[center+x], gg = g[center+x], bb = b[center+x];
               var Y = 0.2126*rr+0.7152*gg+0.0722*bb;
               var blocked = Y >= a.protectFrom;
               if ( blocked ) ++protectedCount;
               var F = blocked ? 0 :
                  afeSmooth( a.faintStart, a.faintFull, Y )*
                  (1-afeSmooth( a.faintFade, a.protectFrom, Y ));
               var smR = sr/9, smG = sg/9, smB = sb/9;
               var C = Math.max( smR, smG, smB )-Math.min( smR, smG, smB );
               var d = smR-0.5*(smG+smB);
               var gate = afeSmooth( a.chromaStart, a.chromaFull, C );
               var allowed = ex ? 1-afeClamp( ex[i], 0, 1 ) : 1;
               var commonMask = F*gate*allowed;
               var H = d > 0 ? commonMask*afeSmooth( a.emissionStart, a.emissionFull, d ) : 0;
               var O = d < 0 ? commonMask*afeSmooth( a.emissionStart, a.emissionFull, -d ) : 0;
               var E = Math.max( H, O );
               mo[i] = E;
               if ( E > 0 ) ++maskedCount;

               var newR = rr, newG = gg, newB = bb;
               if ( E > 0 )
               {
                  var scale = a.gainScale;
                  var common = 1+scale*0.22*E;
                  var wantR = rr*common*(1+scale*0.22*H);
                  var wantG = gg*common*(1+scale*0.14*O);
                  var wantB = bb*common*(1+scale*(0.035*H+0.18*O));
                  // Preserve relative color changes when any channel nears 1.
                  var headroom = 1;
                  if ( wantR > rr ) headroom = Math.min( headroom, (1-rr)/(wantR-rr) );
                  if ( wantG > gg ) headroom = Math.min( headroom, (1-gg)/(wantG-gg) );
                  if ( wantB > bb ) headroom = Math.min( headroom, (1-bb)/(wantB-bb) );
                  headroom = afeClamp( headroom, 0, 1 );
                  if ( headroom < 1 ) ++limitedCount;
                  newR = rr+headroom*(wantR-rr);
                  newG = gg+headroom*(wantG-gg);
                  newB = bb+headroom*(wantB-bb);
               }
               ro[i] = newR; go[i] = newG; bo[i] = newB;
               var delta = Math.max( Math.abs( newR-rr ), Math.abs( newG-gg ), Math.abs( newB-bb ) );
               if ( delta > 1e-12 ) ++changedCount;
               if ( delta > maxDelta ) maxDelta = delta;
               if ( x+1 < w )
               {
                  var left = Math.max( 0, x-1 ), right = Math.min( w-1, x+2 );
                  sr += vr[right]-vr[left];
                  sg += vg[right]-vg[left];
                  sb += vb[right]-vb[left];
               }
            }
         }
         var writeRect = new Rect( 0, y0, w, y1 );
         result.mainView.image.setSamples( ro, writeRect, 0 );
         result.mainView.image.setSamples( go, writeRect, 1 );
         result.mainView.image.setSamples( bo, writeRect, 2 );
         mask.mainView.image.setSamples( mo, writeRect, 0 );
         if ( y1 === h || (Math.floor( y0/tileRows ) % 16) === 0 )
            console.writeln( "Enhanced " + y1 + "/" + h + " rows" );
         processEvents();
         if ( console.abortRequested ) afeFail( "Stopped at user's request" );
      }
      completed = true;
   }
   finally
   {
      for ( var j = begun.length-1; j >= 0; --j ) begun[j].endProcess();
      if ( !completed )
      {
         if ( mask ) mask.forceClose();
         if ( result ) result.forceClose();
      }
   }
   var total = w*h;
   console.writeln( "Protected=" + afePct( protectedCount, total ) +
      "  emission mask=" + afePct( maskedCount, total ) +
      "  changed=" + afePct( changedCount, total ) );
   console.writeln( "Highlight-limited=" + afePct( limitedCount, total ) +
      "  max channel change=" + maxDelta.toFixed( 7 ) );
   mask.show();
   result.show();
   console.writeln( "Done. Source unchanged. Save result as 32-bit XISF." );
}

afeMain();
