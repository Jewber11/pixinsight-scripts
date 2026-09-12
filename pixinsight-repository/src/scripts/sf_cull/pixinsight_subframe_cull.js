#include <pjsr/Sizer.jsh>
#include <pjsr/SectionBar.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>

#feature-id    Sam's Scripts > Automatic Subframe Cull
#feature-info  Recursively measure readable image frames with SubframeSelector, then delete rejected frames.

/*
 * Automatic Subframe Cull
 *
 * SFS approval formula:
 *   FWHMsigma <= 2 && eccentricitysigma <= 2 &&
 *   mediansigma <= 2 && starsigma >= -1.5
 *
 * Use calibrated, linear frames when possible. Every readable image file below
 * the selected directory is treated as a stack frame.
 */

var DEFAULT_APPROVAL_EXPRESSION =
   "FWHMsigma <= 2 && eccentricitysigma <= 2 && mediansigma <= 2 && starsigma >= -1.5";

function selectorConstant( name, fallback )
{
   return typeof SubframeSelector[ name ] == "undefined" ? fallback : SubframeSelector[ name ];
}

function selectorConstantAny( names, fallback )
{
   for ( var i = 0; i < names.length; ++i )
      if ( typeof SubframeSelector[ names[ i ] ] != "undefined" )
         return SubframeSelector[ names[ i ] ];
   return fallback;
}

function defaultConfiguration()
{
   return {
      approvalExpression: DEFAULT_APPROVAL_EXPRESSION,
      weightingExpression: "SNRWeight",
      subframeScale: 1.0000,
      cameraGain: 1.0000,
      cameraResolution: selectorConstant( "Bits16", 65535 ),
      siteLocalMidnight: 24,
      scaleUnit: selectorConstant( "ArcSeconds", 0 ),
      dataUnit: selectorConstant( "DataNumber", 1 ),
      fileCache: true,
      noNoiseAndSignalWarnings: true,
      trimmingFactor: 0.10,
      structureLayers: 5,
      noiseLayers: 0,
      hotPixelFilterRadius: 1,
      applyHotPixelFilter: false,
      noiseReductionFilterRadius: 0,
      sensitivity: 0.1000,
      peakResponse: 0.8000,
      maxDistortion: 0.5000,
      upperLimit: 1.0000,
      backgroundExpansion: 3,
      xyStretch: 1.5000,
      psfFit: selectorConstant( "Moffat4", 4 ),
      psfFitCircular: false,
      roiX0: 0,
      roiY0: 0,
      roiX1: 0,
      roiY1: 0,
      pedestalMode: selectorConstant( "Pedestal_Keyword", 0 ),
      pedestal: 0,
      pedestalKeyword: "",
      inputHints: "",
      useFileThreads: true,
      fileThreadOverload: 1.00,
      maxFileReadThreads: 0,
      maxFileWriteThreads: 0
   };
}

function trimText( text )
{
   return String( text ).replace( /^\s+|\s+$/g, "" );
}

function selectorOptions()
{
   return {
      cameraResolution: [
         [ "8-bit", selectorConstant( "Bits8", 255 ) ],
         [ "10-bit", selectorConstant( "Bits10", 1023 ) ],
         [ "12-bit", selectorConstant( "Bits12", 4095 ) ],
         [ "14-bit", selectorConstant( "Bits14", 16383 ) ],
         [ "16-bit", selectorConstant( "Bits16", 65535 ) ]
      ],
      scaleUnit: [
         [ "Arcseconds", selectorConstant( "ArcSeconds", 0 ) ],
         [ "Pixels", selectorConstant( "Pixels", 1 ) ]
      ],
      dataUnit: [
         [ "Electrons", selectorConstant( "Electron", 0 ) ],
         [ "Data Numbers", selectorConstant( "DataNumber", 1 ) ]
      ],
      psfFit: [
         [ "Gaussian", selectorConstant( "Gaussian", 0 ) ],
         [ "Moffat 1.5", selectorConstantAny( [ "Moffat15", "Moffat1_5" ], 1 ) ],
         [ "Moffat 4", selectorConstant( "Moffat4", 4 ) ],
         [ "Moffat 6", selectorConstant( "Moffat6", 3 ) ],
         [ "Moffat 8", selectorConstant( "Moffat8", 2 ) ],
         [ "Moffat 10", selectorConstant( "Moffat10", 1 ) ],
         [ "Lorentzian", selectorConstant( "Lorentzian", 7 ) ]
      ],
      pedestalMode: [
         [ "Keyword", selectorConstant( "Pedestal_Keyword", 0 ) ],
         [ "Literal value", selectorConstantAny( [ "Pedestal_Literal", "Pedestal_Value" ], 1 ) ]
      ]
   };
}

function optionIndex( options, value )
{
   for ( var i = 0; i < options.length; ++i )
      if ( options[ i ][ 1 ] == value )
         return i;
   return 0;
}

function addEditRow( dialog, section, labelText, fieldName, value, labelWidth )
{
   var row = new HorizontalSizer;
   row.spacing = 4;

   var label = new Label( section );
   label.text = labelText;
   label.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   label.minWidth = labelWidth;
   row.add( label );

   var edit = new Edit( section );
   edit.text = String( value );
   edit.minWidth = 130;
   row.add( edit, 100 );
   section.sizer.add( row );
   dialog.fields[ fieldName ] = edit;
   return edit;
}

function addComboRow( dialog, section, labelText, fieldName, options, value, labelWidth )
{
   var row = new HorizontalSizer;
   row.spacing = 4;

   var label = new Label( section );
   label.text = labelText;
   label.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   label.minWidth = labelWidth;
   row.add( label );

   var combo = new ComboBox( section );
   for ( var i = 0; i < options.length; ++i )
      combo.addItem( options[ i ][ 0 ] );
   combo.currentItem = optionIndex( options, value );
   combo.minWidth = 130;
   row.add( combo, 100 );
   section.sizer.add( row );
   dialog.fields[ fieldName ] = combo;
   dialog.optionValues[ fieldName ] = options;
   return combo;
}

function addCheckRow( dialog, section, fieldName, text, checked )
{
   var checkBox = new CheckBox( section );
   checkBox.text = text;
   checkBox.checked = checked;
   section.sizer.add( checkBox );
   dialog.fields[ fieldName ] = checkBox;
   return checkBox;
}

function addSection( dialog, title, expanded )
{
   var bar = new SectionBar( dialog );
   bar.setTitle( title );

   var section = new Control( dialog );
   section.sizer = new VerticalSizer;
   section.sizer.margin = 4;
   section.sizer.spacing = 4;

   dialog.sizer.add( bar );
   dialog.sizer.add( section );
   if ( !expanded )
      section.hide();
   bar.setSection( section );
   return section;
}

function CullConfigurationDialog()
{
   this.__base__ = Dialog;
   this.__base__();
   this.windowTitle = "Automatic Subframe Cull";
   this.scaledMinWidth = 760;
   this.fields = {};
   this.optionValues = {};

   var defaults = defaultConfiguration();
   var options = selectorOptions();
   var labelWidth = 190;

   var info = new Label( this );
   info.text = "Choose a root directory. Script recurses, measures all readable image frames, then deletes rejected frames. Review settings before running.";
   info.wordWrapping = true;
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( info );

   var inputSection = addSection( this, "Input and Expressions", true );
   var rootRow = new HorizontalSizer;
   rootRow.spacing = 4;
   var rootLabel = new Label( inputSection );
   rootLabel.text = "Root directory:";
   rootLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   rootLabel.minWidth = labelWidth;
   rootRow.add( rootLabel );
   this.rootDirectoryEdit = new Edit( inputSection );
   this.rootDirectoryEdit.minWidth = 130;
   rootRow.add( this.rootDirectoryEdit, 100 );
   var browseButton = new PushButton( inputSection );
   browseButton.text = "Browse...";
   browseButton.onClick = function()
   {
      var dialog = new GetDirectoryDialog;
      dialog.caption = "Select root directory containing frames";
      if ( this.dialog.rootDirectoryEdit.text.length > 0 )
         dialog.directory = this.dialog.rootDirectoryEdit.text;
      if ( dialog.execute() )
         this.dialog.rootDirectoryEdit.text = dialog.directory;
   };
   rootRow.add( browseButton );
   inputSection.sizer.add( rootRow );

   var approvalLabel = new Label( inputSection );
   approvalLabel.text = "Approval expression:";
   approvalLabel.textAlignment = TextAlign_Right | TextAlign_Top;
   approvalLabel.minWidth = labelWidth;
   var approvalBox = new TextBox( inputSection );
   approvalBox.text = defaults.approvalExpression;
   approvalBox.setFixedHeight( 54 );
   var approvalRow = new HorizontalSizer;
   approvalRow.spacing = 4;
   approvalRow.add( approvalLabel );
   approvalRow.add( approvalBox, 100 );
   inputSection.sizer.add( approvalRow );
   this.approvalBox = approvalBox;

   var weightingLabel = new Label( inputSection );
   weightingLabel.text = "Weighting expression:";
   weightingLabel.textAlignment = TextAlign_Right | TextAlign_Top;
   weightingLabel.minWidth = labelWidth;
   var weightingBox = new TextBox( inputSection );
   weightingBox.text = defaults.weightingExpression;
   weightingBox.setFixedHeight( 54 );
   var weightingRow = new HorizontalSizer;
   weightingRow.spacing = 4;
   weightingRow.add( weightingLabel );
   weightingRow.add( weightingBox, 100 );
   inputSection.sizer.add( weightingRow );
   this.weightingBox = weightingBox;

   var systemSection = addSection( this, "System Parameters", false );
   addEditRow( this, systemSection, "Subframe scale:", "subframeScale", defaults.subframeScale, labelWidth );
   addEditRow( this, systemSection, "Camera gain:", "cameraGain", defaults.cameraGain, labelWidth );
   addComboRow( this, systemSection, "Camera resolution:", "cameraResolution", options.cameraResolution, defaults.cameraResolution, labelWidth );
   addEditRow( this, systemSection, "Site local midnight:", "siteLocalMidnight", defaults.siteLocalMidnight, labelWidth );
   addComboRow( this, systemSection, "Scale unit:", "scaleUnit", options.scaleUnit, defaults.scaleUnit, labelWidth );
   addComboRow( this, systemSection, "Data unit:", "dataUnit", options.dataUnit, defaults.dataUnit, labelWidth );
   addCheckRow( this, systemSection, "fileCache", "Use file cache", defaults.fileCache );
   addCheckRow( this, systemSection, "noNoiseAndSignalWarnings", "Suppress noise and signal warnings", defaults.noNoiseAndSignalWarnings );
   systemSection.adjustToContents();
   systemSection.setFixedHeight();

   var detectionSection = addSection( this, "Star Detection and Fitting", false );
   addEditRow( this, detectionSection, "Trimming factor:", "trimmingFactor", defaults.trimmingFactor, labelWidth );
   addEditRow( this, detectionSection, "Structure layers:", "structureLayers", defaults.structureLayers, labelWidth );
   addEditRow( this, detectionSection, "Noise layers:", "noiseLayers", defaults.noiseLayers, labelWidth );
   addEditRow( this, detectionSection, "Hot pixel filter radius:", "hotPixelFilterRadius", defaults.hotPixelFilterRadius, labelWidth );
   addCheckRow( this, detectionSection, "applyHotPixelFilter", "Apply hot pixel filter", defaults.applyHotPixelFilter );
   addEditRow( this, detectionSection, "Noise reduction radius:", "noiseReductionFilterRadius", defaults.noiseReductionFilterRadius, labelWidth );
   addEditRow( this, detectionSection, "Sensitivity:", "sensitivity", defaults.sensitivity, labelWidth );
   addEditRow( this, detectionSection, "Peak response:", "peakResponse", defaults.peakResponse, labelWidth );
   addEditRow( this, detectionSection, "Maximum distortion:", "maxDistortion", defaults.maxDistortion, labelWidth );
   addEditRow( this, detectionSection, "Upper limit:", "upperLimit", defaults.upperLimit, labelWidth );
   addEditRow( this, detectionSection, "Background expansion:", "backgroundExpansion", defaults.backgroundExpansion, labelWidth );
   addEditRow( this, detectionSection, "XY stretch:", "xyStretch", defaults.xyStretch, labelWidth );
   addComboRow( this, detectionSection, "PSF fit:", "psfFit", options.psfFit, defaults.psfFit, labelWidth );
   addCheckRow( this, detectionSection, "psfFitCircular", "Circular PSF fit", defaults.psfFitCircular );
   detectionSection.adjustToContents();
   detectionSection.setFixedHeight();

   var advancedSection = addSection( this, "ROI, Pedestal, and Performance", false );
   addEditRow( this, advancedSection, "ROI X0:", "roiX0", defaults.roiX0, labelWidth );
   addEditRow( this, advancedSection, "ROI Y0:", "roiY0", defaults.roiY0, labelWidth );
   addEditRow( this, advancedSection, "ROI X1:", "roiX1", defaults.roiX1, labelWidth );
   addEditRow( this, advancedSection, "ROI Y1:", "roiY1", defaults.roiY1, labelWidth );
   addComboRow( this, advancedSection, "Pedestal mode:", "pedestalMode", options.pedestalMode, defaults.pedestalMode, labelWidth );
   addEditRow( this, advancedSection, "Pedestal:", "pedestal", defaults.pedestal, labelWidth );
   addEditRow( this, advancedSection, "Pedestal keyword:", "pedestalKeyword", defaults.pedestalKeyword, labelWidth );
   addEditRow( this, advancedSection, "Input hints:", "inputHints", defaults.inputHints, labelWidth );
   addCheckRow( this, advancedSection, "useFileThreads", "Use file threads", defaults.useFileThreads );
   addEditRow( this, advancedSection, "File-thread overload:", "fileThreadOverload", defaults.fileThreadOverload, labelWidth );
   addEditRow( this, advancedSection, "Max file-read threads:", "maxFileReadThreads", defaults.maxFileReadThreads, labelWidth );
   addEditRow( this, advancedSection, "Max file-write threads:", "maxFileWriteThreads", defaults.maxFileWriteThreads, labelWidth );
   advancedSection.adjustToContents();
   advancedSection.setFixedHeight();

   inputSection.adjustToContents();
   inputSection.setFixedHeight();

   var buttons = new HorizontalSizer;
   buttons.spacing = 8;
   buttons.addStretch();
   var runButton = new PushButton( this );
   runButton.text = "Measure and Delete";
   runButton.defaultButton = true;
   runButton.onClick = function() { this.dialog.ok(); };
   buttons.add( runButton );
   var cancelButton = new PushButton( this );
   cancelButton.text = "Cancel";
   cancelButton.onClick = function() { this.dialog.cancel(); };
   buttons.add( cancelButton );
   this.sizer.add( buttons );
}

CullConfigurationDialog.prototype = new Dialog;

function showConfigurationError( message )
{
   (new MessageBox( message, "Automatic Subframe Cull", StdIcon_Error, StdButton_Ok )).execute();
}

function readNumberField( dialog, name, label, integer, minimum )
{
   var text = trimText( dialog.fields[ name ].text );
   var value = Number( text );
   if ( text.length == 0 || !isFinite( value ) || (integer && value != Math.round( value )) ||
        (typeof minimum != "undefined" && value < minimum) )
   {
      showConfigurationError( "Invalid " + label + "." );
      return null;
   }
   return value;
}

function readConfiguration( dialog )
{
   var rootDirectory = trimText( dialog.rootDirectoryEdit.text );
   if ( rootDirectory.length == 0 || !File.directoryExists( rootDirectory ) )
   {
      showConfigurationError( "Root directory does not exist." );
      return null;
   }

   var approvalExpression = trimText( dialog.approvalBox.text );
   if ( approvalExpression.length == 0 )
   {
      showConfigurationError( "Approval expression cannot be empty." );
      return null;
   }

   var config = defaultConfiguration();
   config.rootDirectory = File.fullPath( rootDirectory );
   config.approvalExpression = approvalExpression;
   config.weightingExpression = String( dialog.weightingBox.text );

   var numericFields = [
      [ "subframeScale", "subframe scale", false, 0 ],
      [ "cameraGain", "camera gain", false, 0 ],
      [ "siteLocalMidnight", "site local midnight", true, 0 ],
      [ "trimmingFactor", "trimming factor", false, 0 ],
      [ "structureLayers", "structure layers", true, 0 ],
      [ "noiseLayers", "noise layers", true, 0 ],
      [ "hotPixelFilterRadius", "hot pixel filter radius", true, 0 ],
      [ "noiseReductionFilterRadius", "noise reduction radius", true, 0 ],
      [ "sensitivity", "sensitivity", false, 0 ],
      [ "peakResponse", "peak response", false, 0 ],
      [ "maxDistortion", "maximum distortion", false, 0 ],
      [ "upperLimit", "upper limit", false, 0 ],
      [ "backgroundExpansion", "background expansion", true, 0 ],
      [ "xyStretch", "XY stretch", false, 0 ],
      [ "roiX0", "ROI X0", true, 0 ],
      [ "roiY0", "ROI Y0", true, 0 ],
      [ "roiX1", "ROI X1", true, 0 ],
      [ "roiY1", "ROI Y1", true, 0 ],
      [ "pedestal", "pedestal", false, 0 ],
      [ "fileThreadOverload", "file-thread overload", false, 0 ],
      [ "maxFileReadThreads", "max file-read threads", true, 0 ],
      [ "maxFileWriteThreads", "max file-write threads", true, 0 ]
   ];
   for ( var i = 0; i < numericFields.length; ++i )
   {
      var spec = numericFields[ i ];
      var value = readNumberField( dialog, spec[ 0 ], spec[ 1 ], spec[ 2 ], spec[ 3 ] );
      if ( value === null )
         return null;
      config[ spec[ 0 ] ] = value;
   }

   config.cameraResolution = dialog.optionValues.cameraResolution[ dialog.fields.cameraResolution.currentItem ][ 1 ];
   config.scaleUnit = dialog.optionValues.scaleUnit[ dialog.fields.scaleUnit.currentItem ][ 1 ];
   config.dataUnit = dialog.optionValues.dataUnit[ dialog.fields.dataUnit.currentItem ][ 1 ];
   config.psfFit = dialog.optionValues.psfFit[ dialog.fields.psfFit.currentItem ][ 1 ];
   config.pedestalMode = dialog.optionValues.pedestalMode[ dialog.fields.pedestalMode.currentItem ][ 1 ];

   config.fileCache = dialog.fields.fileCache.checked;
   config.noNoiseAndSignalWarnings = dialog.fields.noNoiseAndSignalWarnings.checked;
   config.applyHotPixelFilter = dialog.fields.applyHotPixelFilter.checked;
   config.psfFitCircular = dialog.fields.psfFitCircular.checked;
   config.useFileThreads = dialog.fields.useFileThreads.checked;
   config.pedestalKeyword = String( dialog.fields.pedestalKeyword.text );
   config.inputHints = String( dialog.fields.inputHints.text );
   return config;
}

function joinPath( directory, name )
{
   if ( directory.length == 0 )
      return name;
   var last = directory.charAt( directory.length - 1 );
   return directory + (last == "/" || last == "\\" ? "" : "/") + name;
}

function isReadableImage( filePath )
{
   var extension = File.extractExtension( filePath ).toLowerCase();
   if ( extension.length == 0 )
      return false;

   var format = new FileFormat( extension, true /*toRead*/, false /*toWrite*/ );
   return !format.isNull;
}

function collectFrames( directory, frames )
{
   var find = new FileFind;
   if ( !find.begin( joinPath( directory, "*" ) ) )
      return;

   do
   {
      if ( find.name == "." || find.name == ".." )
         continue;

      var path = File.fullPath( joinPath( directory, find.name ) );
      if ( find.isDirectory )
         collectFrames( path, frames );
      else if ( isReadableImage( path ) )
         frames.push( path );
   }
   while ( find.next() );
}

function makeSubframeRows( frames )
{
   var rows = [];
   for ( var i = 0; i < frames.length; ++i )
      rows.push( [ true, frames[ i ], "", "" ] );
   return rows;
}

function abortWithMessage( message )
{
   console.criticalln( "** Error: " + message );
   throw new Error( message );
}

function main()
{
   var configurationDialog = new CullConfigurationDialog;
   if ( !configurationDialog.execute() )
      return;

   var config = readConfiguration( configurationDialog );
   if ( config === null )
      return;

   var rootDirectory = config.rootDirectory;
   var frames = [];
   collectFrames( rootDirectory, frames );
   frames.sort();

   if ( frames.length == 0 )
      abortWithMessage( "No readable image frames found below: " + rootDirectory );

   console.writeln( "Root directory: " + rootDirectory );
   console.writeln( "Frames found: " + frames.length );
   console.writeln( "Approval: " + config.approvalExpression );

   var selector = new SubframeSelector;
   selector.routine = SubframeSelector.MeasureSubframes;
   selector.nonInteractive = true;
   selector.subframeScale = config.subframeScale;
   selector.cameraGain = config.cameraGain;
   selector.cameraResolution = config.cameraResolution;
   selector.siteLocalMidnight = config.siteLocalMidnight;
   selector.scaleUnit = config.scaleUnit;
   selector.dataUnit = config.dataUnit;
   selector.fileCache = config.fileCache;
   selector.noNoiseAndSignalWarnings = config.noNoiseAndSignalWarnings;
   selector.trimmingFactor = config.trimmingFactor;
   selector.structureLayers = config.structureLayers;
   selector.noiseLayers = config.noiseLayers;
   selector.hotPixelFilterRadius = config.hotPixelFilterRadius;
   selector.applyHotPixelFilter = config.applyHotPixelFilter;
   selector.noiseReductionFilterRadius = config.noiseReductionFilterRadius;
   selector.sensitivity = config.sensitivity;
   selector.peakResponse = config.peakResponse;
   selector.maxDistortion = config.maxDistortion;
   selector.upperLimit = config.upperLimit;
   selector.backgroundExpansion = config.backgroundExpansion;
   selector.xyStretch = config.xyStretch;
   selector.psfFit = config.psfFit;
   selector.psfFitCircular = config.psfFitCircular;
   selector.roiX0 = config.roiX0;
   selector.roiY0 = config.roiY0;
   selector.roiX1 = config.roiX1;
   selector.roiY1 = config.roiY1;
   selector.pedestalMode = config.pedestalMode;
   selector.pedestal = config.pedestal;
   selector.pedestalKeyword = config.pedestalKeyword;
   selector.inputHints = config.inputHints;
   selector.outputHints = "";
   selector.onError = SubframeSelector.Continue;
   selector.useFileThreads = config.useFileThreads;
   selector.fileThreadOverload = config.fileThreadOverload;
   selector.maxFileReadThreads = config.maxFileReadThreads;
   selector.maxFileWriteThreads = config.maxFileWriteThreads;
   selector.approvalExpression = config.approvalExpression;
   selector.weightingExpression = config.weightingExpression;
   selector.subframes = makeSubframeRows( frames );

   if ( !selector.executeGlobal() )
      abortWithMessage( "SubframeSelector failed. No files deleted." );

   // Native SubframeSelector measurement columns:
   //   0 = index, 1 = approved, 2 = locked, 3 = file path.
   var approvals = {};
   var measurementCount = selector.measurements.length;
   for ( var i = 0; i < measurementCount; ++i )
   {
      var measurement = selector.measurements[ i ];
      if ( measurement.length < 4 )
         abortWithMessage( "Unexpected SubframeSelector result row. No files deleted." );

      var measuredPath = File.fullPath( String( measurement[ 3 ] ) );
      var approved = measurement[ 1 ];
      if ( typeof approved != "boolean" && approved != 0 && approved != 1 )
         abortWithMessage( "Unexpected approval value for: " + measuredPath + ". No files deleted." );

      approvals[ measuredPath ] = approved === true || approved === 1;
   }

   var missing = [];
   for ( var j = 0; j < frames.length; ++j )
      if ( !Object.prototype.hasOwnProperty.call( approvals, frames[ j ] ) )
         missing.push( frames[ j ] );

   if ( missing.length > 0 )
   {
      console.warningln( "** Warning: " + missing.length + " frame(s) had no valid measurement. No files deleted." );
      for ( var k = 0; k < missing.length; ++k )
         console.warningln( "   " + missing[ k ] );
      return;
   }

   var rejected = [];
   for ( var n = 0; n < frames.length; ++n )
      if ( !approvals[ frames[ n ] ] )
         rejected.push( frames[ n ] );

   var deleted = 0;
   var failed = [];
   for ( var r = 0; r < rejected.length; ++r )
   {
      var rejectedPath = rejected[ r ];
      try
      {
         File.remove( rejectedPath );
      }
      catch ( error )
      {
         failed.push( rejectedPath + " (" + error + ")" );
         continue;
      }

      if ( File.exists( rejectedPath ) )
         failed.push( rejectedPath + " (delete failed)" );
      else
         ++deleted;
   }

   console.writeln( "Approved: " + (frames.length - rejected.length) );
   console.writeln( "Rejected: " + rejected.length );
   console.writeln( "Deleted: " + deleted );

   if ( failed.length > 0 )
   {
      console.warningln( "** Warning: " + failed.length + " rejected frame(s) not deleted:" );
      for ( var q = 0; q < failed.length; ++q )
         console.warningln( "   " + failed[ q ] );
   }
}

main();
