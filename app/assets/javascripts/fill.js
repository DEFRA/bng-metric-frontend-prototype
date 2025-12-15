//
// Fill polygon selection module for OS NGD polygon features
// Allows users to select one or more adjacent OS polygon features
// and merge them into a single red-line boundary
//

(function(window) {
  'use strict';

  // OS NGD polygon layers to query for fill selection
  const FILL_POLYGON_LAYERS = [
    // Land areas (fields)
    'lnd-fts-land-1',
    'lnd-fts-land-2',
    'lnd-fts-land-3',
    // Site extents
    'lus-fts-site-1',
    'lus-fts-site-2',
    // Buildings
    'bld-fts-building-1',
    'bld-fts-building-2',
    'bld-fts-building-3',
    // Water bodies
    'wtr-fts-water-1',
    'wtr-fts-water-2',
    'wtr-fts-water-3'
  ];

  // Module state
  let map = null;
  let snapIndexSource = null;
  let previewLayer = null;
  let previewSource = null;
  let isFillModeActive = false;
  let fillMode = 'red-line-boundary';  // 'red-line-boundary' or 'habitat-parcels'
  let selectedPolygons = [];  // Array of { feature, geometry, layerType }
  let existingBoundaryGeometry = null;  // Existing red-line boundary to merge with (for red-line mode)
  let constraintBoundary = null;  // Boundary that parcels must be within (for habitat-parcels mode)

  // Callbacks
  let onSelectionChange = null;
  let onConfirm = null;
  let onError = null;
  let onParcelAdded = null;  // Called when a parcel is added in habitat-parcels mode

  // Styling for selected polygons
  const SELECTED_STYLE = new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: 'rgba(29, 112, 184, 1)',  // GOV.UK blue
      width: 2,
      lineDash: [8, 4]
    }),
    fill: new ol.style.Fill({
      color: 'rgba(29, 112, 184, 0.3)'
    })
  });

  const HOVER_STYLE = new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: 'rgba(255, 165, 0, 1)',  // Orange
      width: 1.5
    }),
    fill: new ol.style.Fill({
      color: 'rgba(255, 165, 0, 0.2)'
    })
  });

  /**
   * Initialize the fill tool
   * @param {ol.Map} olMap - OpenLayers map instance
   * @param {Object} config - Configuration options
   * @param {string} config.mode - 'red-line-boundary' or 'habitat-parcels'
   * @param {Function} config.onSelectionChange - Called when selection changes
   * @param {Function} config.onConfirm - Called when selection is confirmed
   * @param {Function} config.onError - Called on error
   * @param {Function} config.onParcelAdded - Called when a parcel is added (habitat-parcels mode)
   */
  function init(olMap, config = {}) {
    map = olMap;
    fillMode = config.mode || 'red-line-boundary';
    onSelectionChange = config.onSelectionChange || null;
    onConfirm = config.onConfirm || null;
    onError = config.onError || null;
    onParcelAdded = config.onParcelAdded || null;

    console.log('=== Fill Tool Initializing ===');
    console.log('Mode:', fillMode);

    // Get reference to snap index source from SnapDrawing module
    if (window.SnapDrawing && window.SnapDrawing.getDrawSource) {
      // We'll query features directly from the map's layers
      console.log('✓ Fill tool will query map features directly');
    }

    setupPreviewLayer();

    console.log('✓ Fill tool initialized');
    console.log('Polygon layers to query:', FILL_POLYGON_LAYERS);
  }

  /**
   * Set up the preview layer for selected polygons
   */
  function setupPreviewLayer() {
    previewSource = new ol.source.Vector();
    previewLayer = new ol.layer.Vector({
      source: previewSource,
      style: SELECTED_STYLE,
      zIndex: 60  // Above draw layer but below hover
    });
    map.addLayer(previewLayer);
  }

  /**
   * Start fill selection mode for red-line boundary
   */
  function startFillMode() {
    if (isFillModeActive) {
      console.warn('Fill mode already active');
      return;
    }

    fillMode = 'red-line-boundary';
    isFillModeActive = true;
    selectedPolygons = [];
    existingBoundaryGeometry = null;
    constraintBoundary = null;
    previewSource.clear();

    // If there's an existing polygon from SnapDrawing, capture it for adjacency checking
    if (window.SnapDrawing && window.SnapDrawing.isPolygonComplete && window.SnapDrawing.isPolygonComplete()) {
      const existingCoords = window.SnapDrawing.getCurrentPolygonCoords();
      if (existingCoords && existingCoords.length >= 4) {
        existingBoundaryGeometry = new ol.geom.Polygon([existingCoords]);
        console.log('Existing polygon captured for adjacency checking');
        
        // Show the existing boundary in preview as well
        const previewFeature = new ol.Feature({
          geometry: existingBoundaryGeometry.clone(),
          layerType: 'existing-boundary',
          isExisting: true
        });
        previewSource.addFeature(previewFeature);
      }
    }

    // Change cursor
    map.getTargetElement().style.cursor = 'crosshair';

    // Add click handler
    map.on('click', handleFillClick);
    map.on('pointermove', handleFillHover);

    console.log('✏️ Fill mode started (red-line-boundary) - click on polygons to select');
    if (existingBoundaryGeometry) {
      console.log('Select adjacent polygons to expand, or non-adjacent to replace');
    }

    // Debug: Log available polygon features
    debugAvailablePolygons();

    updateUI();
  }

  /**
   * Start fill selection mode for habitat parcels
   * Each selected polygon becomes a new habitat parcel
   */
  function startFillModeForParcels() {
    if (isFillModeActive) {
      console.warn('Fill mode already active');
      return;
    }

    // Get the boundary from SnapDrawing
    if (window.SnapDrawing && window.SnapDrawing.getBoundaryPolygon) {
      constraintBoundary = window.SnapDrawing.getBoundaryPolygon();
    }

    if (!constraintBoundary) {
      console.error('No boundary available for parcel fill mode');
      if (onError) {
        onError('No red-line boundary defined. Please define a boundary first.', 'error');
      }
      return;
    }

    fillMode = 'habitat-parcels';
    isFillModeActive = true;
    selectedPolygons = [];
    existingBoundaryGeometry = null;
    previewSource.clear();

    // Change cursor
    map.getTargetElement().style.cursor = 'crosshair';

    // Add click handler
    map.on('click', handleFillClickForParcels);
    map.on('pointermove', handleFillHover);

    console.log('✏️ Fill mode started (habitat-parcels) - click on polygons within boundary to add as parcels');

    // Debug: Log available polygon features
    debugAvailablePolygons();

    updateUIForParcelMode();
  }

  /**
   * Debug function to log available polygon features
   */
  function debugAvailablePolygons() {
    let snapSource = null;
    if (window.SnapDrawing && window.SnapDrawing.getSnapIndexSource) {
      snapSource = window.SnapDrawing.getSnapIndexSource();
    }

    if (!snapSource) {
      console.warn('⚠️ Snap index source not available - zoom in to at least level 14');
      if (onError) {
        onError('Zoom in to at least level 14 to enable polygon selection.', 'warning');
      }
      return;
    }

    const features = snapSource.getFeatures();
    console.log(`📊 Total features in snap index: ${features.length}`);

    // Count features by geometry type and layer
    const stats = {
      total: features.length,
      polygons: 0,
      multiPolygons: 0,
      lineStrings: 0,
      multiLineStrings: 0,
      points: 0,
      other: 0,
      byLayer: {}
    };

    const polygonsByLayer = {};

    for (const feature of features) {
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const geomType = geometry.getType();
      const layerType = feature.get('layerType') || 'unknown';

      // Count by type
      if (geomType === 'Polygon') {
        stats.polygons++;
        polygonsByLayer[layerType] = (polygonsByLayer[layerType] || 0) + 1;
      } else if (geomType === 'MultiPolygon') {
        stats.multiPolygons++;
        polygonsByLayer[layerType] = (polygonsByLayer[layerType] || 0) + 1;
      } else if (geomType === 'LineString') {
        stats.lineStrings++;
      } else if (geomType === 'MultiLineString') {
        stats.multiLineStrings++;
      } else if (geomType === 'Point' || geomType === 'MultiPoint') {
        stats.points++;
      } else {
        stats.other++;
      }

      // Count by layer
      stats.byLayer[layerType] = (stats.byLayer[layerType] || 0) + 1;
    }

    console.log('📊 Feature statistics:');
    console.log(`  - Polygons: ${stats.polygons}`);
    console.log(`  - MultiPolygons: ${stats.multiPolygons}`);
    console.log(`  - LineStrings: ${stats.lineStrings}`);
    console.log(`  - MultiLineStrings: ${stats.multiLineStrings}`);
    console.log(`  - Points: ${stats.points}`);
    console.log('📊 Features by layer:', stats.byLayer);
    console.log('📊 Polygons by layer:', polygonsByLayer);

    const totalPolygons = stats.polygons + stats.multiPolygons;
    if (totalPolygons === 0) {
      console.warn('⚠️ No polygon features found in current view!');
      console.log('This could mean:');
      console.log('  1. The OS API is not returning polygon features for this area');
      console.log('  2. The area needs more zoom to load land parcel data');
      console.log('  3. The land/site layers are not available in this region');
      if (onError) {
        onError('No polygon features found in this area. Try zooming in more or panning to a different location.', 'info');
      }
    } else {
      console.log(`✅ Found ${totalPolygons} polygon features available for selection`);
    }
  }

  /**
   * Handle click events in fill mode
   * @param {ol.MapBrowserEvent} evt
   */
  function handleFillClick(evt) {
    if (!isFillModeActive) {
      return;
    }

    const clickedPolygon = findPolygonAtPixel(evt.pixel);

    if (clickedPolygon) {
      togglePolygonSelection(clickedPolygon);
    } else {
      console.log('No polygon feature found at click location');
      
      // Additional debug: check for ANY polygon at this location
      const anyPolygon = findAnyPolygonAtPixel(evt.pixel);
      if (anyPolygon) {
        console.log(`Found polygon from non-target layer: ${anyPolygon.layerType}`);
        if (onError) {
          onError(`Found a "${anyPolygon.layerType}" feature here, but it's not a land/site polygon. Try clicking on a field or land parcel.`, 'info');
        }
      } else {
        if (onError) {
          onError('No OS polygon found at this location. Try clicking on a field, building, or other defined area.', 'info');
        }
      }
    }
  }

  /**
   * Find ANY polygon at pixel (for debugging - includes non-target layers)
   * @param {Array} pixel
   * @returns {Object|null}
   */
  function findAnyPolygonAtPixel(pixel) {
    const coordinate = map.getCoordinateFromPixel(pixel);
    if (!coordinate) return null;

    let snapSource = null;
    if (window.SnapDrawing && window.SnapDrawing.getSnapIndexSource) {
      snapSource = window.SnapDrawing.getSnapIndexSource();
    }
    if (!snapSource) return null;

    const features = snapSource.getFeatures();
    
    for (const feature of features) {
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const geomType = geometry.getType();
      if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') continue;

      let containsPoint = false;
      if (geomType === 'Polygon') {
        containsPoint = geometry.intersectsCoordinate(coordinate);
      } else if (geomType === 'MultiPolygon') {
        const polygons = geometry.getPolygons();
        for (const poly of polygons) {
          if (poly.intersectsCoordinate(coordinate)) {
            containsPoint = true;
            break;
          }
        }
      }

      if (containsPoint) {
        return {
          feature: feature,
          geometry: geometry,
          layerType: feature.get('layerType') || 'unknown'
        };
      }
    }

    return null;
  }

  /**
   * Handle click events in fill mode for habitat parcels
   * Each click adds a new parcel if valid
   * @param {ol.MapBrowserEvent} evt
   */
  function handleFillClickForParcels(evt) {
    if (!isFillModeActive || fillMode !== 'habitat-parcels') {
      return;
    }

    const clickedPolygon = findPolygonAtPixel(evt.pixel);

    if (clickedPolygon) {
      // Validate that the polygon is within the boundary
      const validation = validatePolygonWithinBoundary(clickedPolygon.geometry);
      
      if (!validation.valid) {
        console.warn('Selected polygon is outside boundary:', validation.error);
        if (onError) {
          onError(validation.error, 'warning');
        }
        return;
      }

      // Check for overlap with existing parcels
      const overlapCheck = checkOverlapWithExistingParcels(clickedPolygon.geometry);
      if (!overlapCheck.valid) {
        console.warn('Selected polygon overlaps with existing parcel');
        if (onError) {
          onError(overlapCheck.error, 'warning');
        }
        return;
      }

      // Add as a new parcel
      addPolygonAsParcel(clickedPolygon);
    } else {
      console.log('No polygon feature found at click location');
      
      // Additional debug: check for ANY polygon at this location
      const anyPolygon = findAnyPolygonAtPixel(evt.pixel);
      if (anyPolygon) {
        // Check if it's outside the boundary
        const validation = validatePolygonWithinBoundary(anyPolygon.geometry);
        if (!validation.valid) {
          if (onError) {
            onError('This polygon is outside the red-line boundary and cannot be selected.', 'warning');
          }
        } else {
          if (onError) {
            onError(`Found a "${anyPolygon.layerType}" feature here, but it's not a land/site polygon.`, 'info');
          }
        }
      } else {
        if (onError) {
          onError('No OS polygon found at this location.', 'info');
        }
      }
    }
  }

  /**
   * Validate that a polygon is completely within the constraint boundary
   * @param {ol.geom.Geometry} geometry - The polygon to validate
   * @returns {Object} { valid: boolean, error: string|null }
   */
  function validatePolygonWithinBoundary(geometry) {
    if (!constraintBoundary) {
      return { valid: false, error: 'No boundary defined for validation.' };
    }

    const poly = geometryToPolygon(geometry);
    if (!poly) {
      return { valid: false, error: 'Invalid polygon geometry.' };
    }

    // Use validation module if available
    if (window.ParcelValidation && window.ParcelValidation.isPolygonWithinBoundary) {
      if (window.ParcelValidation.isPolygonWithinBoundary(poly, constraintBoundary)) {
        return { valid: true, error: null };
      } else {
        return { valid: false, error: 'This polygon extends outside the red-line boundary.' };
      }
    }

    // Fallback: check if all vertices are within boundary
    const coords = poly.getCoordinates()[0];
    for (const coord of coords) {
      if (!constraintBoundary.intersectsCoordinate(coord)) {
        return { valid: false, error: 'This polygon extends outside the red-line boundary.' };
      }
    }

    return { valid: true, error: null };
  }

  /**
   * Check if a polygon overlaps with any existing habitat parcels
   * @param {ol.geom.Geometry} geometry - The polygon to check
   * @returns {Object} { valid: boolean, error: string|null }
   */
  function checkOverlapWithExistingParcels(geometry) {
    const poly = geometryToPolygon(geometry);
    if (!poly) {
      return { valid: false, error: 'Invalid polygon geometry.' };
    }

    // Get existing parcels from SnapDrawing
    let existingParcels = [];
    if (window.SnapDrawing && window.SnapDrawing.getHabitatParcels) {
      existingParcels = window.SnapDrawing.getHabitatParcels();
    }

    if (existingParcels.length === 0) {
      return { valid: true, error: null };
    }

    // Use validation module to check overlaps
    if (window.ParcelValidation && window.ParcelValidation.doPolygonsOverlap) {
      for (let i = 0; i < existingParcels.length; i++) {
        const parcelGeom = existingParcels[i].feature.getGeometry();
        if (window.ParcelValidation.doPolygonsOverlap(poly, parcelGeom)) {
          return { valid: false, error: `This polygon overlaps with parcel ${i + 1}.` };
        }
      }
    }

    return { valid: true, error: null };
  }

  /**
   * Add a selected polygon as a new habitat parcel
   * @param {Object} polygonInfo - { feature, geometry, layerType }
   */
  function addPolygonAsParcel(polygonInfo) {
    const poly = geometryToPolygon(polygonInfo.geometry);
    if (!poly) {
      console.error('Failed to convert geometry to polygon');
      return;
    }

    const coords = poly.getCoordinates()[0];

    console.log(`Adding polygon as parcel from layer: ${polygonInfo.layerType}`);
    console.log(`Parcel has ${coords.length - 1} vertices`);

    // Use SnapDrawing to add the parcel
    if (window.SnapDrawing && window.SnapDrawing.addParcelFromCoordinates) {
      const success = window.SnapDrawing.addParcelFromCoordinates(coords);
      if (success) {
        console.log('✓ Parcel added successfully');
        if (onError) {
          onError('Parcel added successfully!', 'success');
        }
        if (onParcelAdded) {
          onParcelAdded({
            geometry: poly,
            coordinates: coords,
            area: poly.getArea(),
            areaHectares: poly.getArea() / 10000,
            layerType: polygonInfo.layerType
          });
        }
      } else {
        console.error('Failed to add parcel');
        if (onError) {
          onError('Failed to add parcel. Please try again.', 'error');
        }
      }
    } else {
      console.error('SnapDrawing.addParcelFromCoordinates not available');
      if (onError) {
        onError('Unable to add parcel - drawing module not ready.', 'error');
      }
    }
  }

  /**
   * Handle hover events in fill mode to show potential selection
   * @param {ol.MapBrowserEvent} evt
   */
  function handleFillHover(evt) {
    if (!isFillModeActive || evt.dragging) {
      return;
    }

    // Throttle hover checks for performance
    if (hoverThrottleTimeout) return;
    hoverThrottleTimeout = setTimeout(() => {
      hoverThrottleTimeout = null;
    }, 50);

    // Check for polygon under cursor
    const polygon = findPolygonAtPixel(evt.pixel, true);  // silent mode for hover
    map.getTargetElement().style.cursor = polygon ? 'pointer' : 'crosshair';
  }

  // Throttle variable for hover
  let hoverThrottleTimeout = null;

  /**
   * Find a polygon feature at the given pixel
   * Queries the snap index source directly since it's invisible (style: null)
   * @param {Array} pixel - [x, y] pixel coordinates
   * @param {boolean} silent - If true, suppress console logging (for hover)
   * @returns {Object|null} { feature, geometry, layerType } or null
   */
  function findPolygonAtPixel(pixel, silent = false) {
    // Get coordinate from pixel
    const coordinate = map.getCoordinateFromPixel(pixel);
    if (!coordinate) {
      if (!silent) console.log('Could not get coordinate from pixel');
      return null;
    }

    // Get snap index source from SnapDrawing module
    let snapSource = null;
    if (window.SnapDrawing && window.SnapDrawing.getSnapIndexSource) {
      snapSource = window.SnapDrawing.getSnapIndexSource();
    }

    if (!snapSource) {
      if (!silent) console.warn('Snap index source not available - ensure map is zoomed in enough');
      return null;
    }

    const features = snapSource.getFeatures();
    if (!silent) {
      console.log(`Checking ${features.length} features at coordinate [${coordinate[0].toFixed(2)}, ${coordinate[1].toFixed(2)}]`);
    }

    // Find polygons that contain the clicked coordinate
    let foundPolygon = null;
    let smallestArea = Infinity;

    for (const feature of features) {
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const geomType = geometry.getType();

      // Only consider polygon geometries
      if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
        continue;
      }

      // Check if this feature is from one of our target layers
      const layerType = feature.get('layerType');
      if (!layerType || !FILL_POLYGON_LAYERS.includes(layerType)) {
        continue;
      }

      // Check if the coordinate is inside this polygon
      let containsPoint = false;
      if (geomType === 'Polygon') {
        containsPoint = geometry.intersectsCoordinate(coordinate);
      } else if (geomType === 'MultiPolygon') {
        // Check each polygon in the multipolygon
        const polygons = geometry.getPolygons();
        for (const poly of polygons) {
          if (poly.intersectsCoordinate(coordinate)) {
            containsPoint = true;
            break;
          }
        }
      }

      if (containsPoint) {
        // Prefer smaller polygons (more specific/detailed features)
        const area = getPolygonArea(geometry);
        if (area < smallestArea) {
          smallestArea = area;
          foundPolygon = {
            feature: feature,
            geometry: geometry,
            layerType: layerType
          };
        }
      }
    }

    if (!silent) {
      if (foundPolygon) {
        console.log(`Found polygon from layer: ${foundPolygon.layerType}, area: ${(smallestArea / 10000).toFixed(2)} ha`);
      } else {
        // Log available polygon layers for debugging
        const polygonLayers = new Set();
        for (const feature of features) {
          const geom = feature.getGeometry();
          if (geom && (geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon')) {
            polygonLayers.add(feature.get('layerType'));
          }
        }
        console.log('No polygon found at this location. Available polygon layers:', Array.from(polygonLayers));
      }
    }

    return foundPolygon;
  }

  /**
   * Toggle selection of a polygon
   * @param {Object} polygonInfo - { feature, geometry, layerType }
   */
  function togglePolygonSelection(polygonInfo) {
    // Check if already selected (by comparing geometry coordinates)
    const existingIndex = findSelectedIndex(polygonInfo);

    if (existingIndex >= 0) {
      // Deselect
      selectedPolygons.splice(existingIndex, 1);
      console.log(`Deselected polygon from layer: ${polygonInfo.layerType}`);
    } else {
      // Check adjacency if there are already selected polygons OR an existing boundary
      if (selectedPolygons.length > 0 || existingBoundaryGeometry) {
        const isAdjacent = checkAdjacencyWithSelection(polygonInfo.geometry);
        if (!isAdjacent) {
          // Not adjacent - clear existing selection and existing boundary
          console.log('Selected polygon is not adjacent - replacing existing selection and boundary');
          selectedPolygons = [];
          existingBoundaryGeometry = null;  // Clear the existing boundary reference
          previewSource.clear();
          if (onError) {
            onError('New polygon selected. Previous boundary cleared as it was not adjacent.', 'info');
          }
        } else if (existingBoundaryGeometry && selectedPolygons.length === 0) {
          // First selection that IS adjacent to existing boundary
          console.log('Selected polygon is adjacent to existing boundary - will be merged');
        }
      }

      // Add to selection
      selectedPolygons.push(polygonInfo);
      console.log(`Selected polygon from layer: ${polygonInfo.layerType}`);
      
      const totalPolygons = selectedPolygons.length + (existingBoundaryGeometry ? 1 : 0);
      if (totalPolygons > 1) {
        console.log(`Now have ${totalPolygons} adjacent polygons - they will be merged`);
      }
    }

    updatePreviewLayer();
    updateUI();

    if (onSelectionChange) {
      onSelectionChange(getSelectionInfo());
    }
  }

  /**
   * Find the index of a polygon in the selection
   * @param {Object} polygonInfo
   * @returns {number} Index or -1 if not found
   */
  function findSelectedIndex(polygonInfo) {
    const coords1 = getPolygonCoordinates(polygonInfo.geometry);

    for (let i = 0; i < selectedPolygons.length; i++) {
      const coords2 = getPolygonCoordinates(selectedPolygons[i].geometry);

      // Compare first coordinate as quick check
      if (coordsEqual(coords1[0], coords2[0]) && coords1.length === coords2.length) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Get coordinates from polygon or multipolygon
   * @param {ol.geom.Geometry} geometry
   * @returns {Array} Exterior ring coordinates
   */
  function getPolygonCoordinates(geometry) {
    const type = geometry.getType();
    if (type === 'Polygon') {
      return geometry.getCoordinates()[0];
    } else if (type === 'MultiPolygon') {
      // Use first polygon for comparison
      return geometry.getCoordinates()[0][0];
    }
    return [];
  }

  /**
   * Check if two coordinates are equal
   */
  function coordsEqual(c1, c2) {
    if (!c1 || !c2) return false;
    return Math.abs(c1[0] - c2[0]) < 0.001 && Math.abs(c1[1] - c2[1]) < 0.001;
  }

  /**
   * Check if a polygon is adjacent to any of the currently selected polygons
   * or the existing boundary (if any)
   * @param {ol.geom.Geometry} geometry
   * @returns {boolean}
   */
  function checkAdjacencyWithSelection(geometry) {
    // If no selection and no existing boundary, adjacency doesn't apply
    if (selectedPolygons.length === 0 && !existingBoundaryGeometry) {
      return true;
    }

    const poly1 = geometryToPolygon(geometry);
    if (!poly1) return false;

    // Use validation module if available
    if (window.ParcelValidation && window.ParcelValidation.arePolygonsAdjacent) {
      // Check against existing boundary
      if (existingBoundaryGeometry) {
        if (window.ParcelValidation.arePolygonsAdjacent(poly1, existingBoundaryGeometry)) {
          return true;
        }
      }

      // Check against selected polygons
      for (const selected of selectedPolygons) {
        const poly2 = geometryToPolygon(selected.geometry);
        if (poly2 && window.ParcelValidation.arePolygonsAdjacent(poly1, poly2)) {
          return true;
        }
      }
      return false;
    }

    // Fallback: use extent-based proximity check
    const extent1 = geometry.getExtent();
    const buffer = 1;  // 1 meter buffer for adjacency

    // Check against existing boundary
    if (existingBoundaryGeometry) {
      const existingExtent = existingBoundaryGeometry.getExtent();
      const bufferedExtent1 = [
        extent1[0] - buffer,
        extent1[1] - buffer,
        extent1[2] + buffer,
        extent1[3] + buffer
      ];
      if (ol.extent.intersects(bufferedExtent1, existingExtent)) {
        return true;
      }
    }

    // Check against selected polygons
    for (const selected of selectedPolygons) {
      const extent2 = selected.geometry.getExtent();
      const bufferedExtent1 = [
        extent1[0] - buffer,
        extent1[1] - buffer,
        extent1[2] + buffer,
        extent1[3] + buffer
      ];
      if (ol.extent.intersects(bufferedExtent1, extent2)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Convert geometry to ol.geom.Polygon (handles MultiPolygon)
   * @param {ol.geom.Geometry} geometry
   * @returns {ol.geom.Polygon}
   */
  function geometryToPolygon(geometry) {
    const type = geometry.getType();
    if (type === 'Polygon') {
      return geometry;
    } else if (type === 'MultiPolygon') {
      // Return first polygon
      const coords = geometry.getCoordinates()[0];
      return new ol.geom.Polygon(coords);
    }
    return null;
  }

  /**
   * Update the preview layer with selected polygons
   */
  function updatePreviewLayer() {
    previewSource.clear();

    // Show existing boundary if present
    if (existingBoundaryGeometry) {
      const existingFeature = new ol.Feature({
        geometry: existingBoundaryGeometry.clone(),
        layerType: 'existing-boundary',
        isExisting: true
      });
      previewSource.addFeature(existingFeature);
    }

    // Show selected polygons
    for (const selected of selectedPolygons) {
      const previewFeature = new ol.Feature({
        geometry: selected.geometry.clone(),
        layerType: selected.layerType
      });
      previewSource.addFeature(previewFeature);
    }
  }

  /**
   * Get information about current selection
   * @returns {Object} { count, totalArea, polygons, hasExistingBoundary }
   */
  function getSelectionInfo() {
    let totalArea = 0;
    let count = selectedPolygons.length;

    // Include existing boundary in area calculation if present
    if (existingBoundaryGeometry) {
      totalArea += existingBoundaryGeometry.getArea();
      count++;
    }

    for (const selected of selectedPolygons) {
      const area = getPolygonArea(selected.geometry);
      totalArea += area;
    }

    return {
      count: count,
      selectedCount: selectedPolygons.length,
      totalArea: totalArea,
      totalAreaHectares: totalArea / 10000,
      polygons: selectedPolygons,
      hasExistingBoundary: !!existingBoundaryGeometry
    };
  }

  /**
   * Get area of a polygon geometry
   * @param {ol.geom.Geometry} geometry
   * @returns {number} Area in square meters
   */
  function getPolygonArea(geometry) {
    const type = geometry.getType();
    if (type === 'Polygon') {
      return geometry.getArea();
    } else if (type === 'MultiPolygon') {
      let total = 0;
      geometry.getPolygons().forEach(poly => {
        total += poly.getArea();
      });
      return total;
    }
    return 0;
  }

  /**
   * Merge selected polygons into a single polygon
   * Also includes the existing boundary if present
   * @returns {ol.geom.Polygon|null} Merged polygon or null if merge fails
   */
  function mergeSelectedPolygons() {
    // Collect all polygons to merge (existing boundary + selections)
    const allPolygonsToMerge = [];

    // Add existing boundary if present
    if (existingBoundaryGeometry) {
      allPolygonsToMerge.push(existingBoundaryGeometry);
    }

    // Add selected polygons
    for (const selected of selectedPolygons) {
      const poly = geometryToPolygon(selected.geometry);
      if (poly) {
        allPolygonsToMerge.push(poly);
      }
    }

    if (allPolygonsToMerge.length === 0) {
      return null;
    }

    if (allPolygonsToMerge.length === 1) {
      // Single polygon, just return it
      return allPolygonsToMerge[0].clone();
    }

    // Multiple polygons - need to merge
    console.log(`Merging ${allPolygonsToMerge.length} polygons (${existingBoundaryGeometry ? 'including existing boundary' : 'new selections only'})...`);

    try {
      // Use a simple union approach: combine all rings and find outer boundary
      const mergedCoords = mergePolygonCoordinates(allPolygonsToMerge);

      if (mergedCoords) {
        const merged = new ol.geom.Polygon([mergedCoords]);
        console.log('✓ Polygons merged successfully');
        return merged;
      } else {
        console.error('Failed to merge polygons');
        return null;
      }
    } catch (error) {
      console.error('Error merging polygons:', error);
      return null;
    }
  }

  /**
   * Merge polygon coordinates by finding the outer boundary
   * This uses a convex hull approach combined with edge walking
   * @param {Array} polygons - Array of ol.geom.Polygon
   * @returns {Array|null} Merged exterior ring coordinates
   */
  function mergePolygonCoordinates(polygons) {
    if (polygons.length === 0) return null;
    if (polygons.length === 1) return polygons[0].getCoordinates()[0];

    // Collect all edges from all polygons
    const allEdges = [];
    const edgeMap = new Map();  // Track edge usage

    for (const polygon of polygons) {
      const coords = polygon.getCoordinates()[0];
      for (let i = 0; i < coords.length - 1; i++) {
        const edge = {
          start: coords[i],
          end: coords[i + 1]
        };
        const edgeKey = getEdgeKey(edge);
        const reverseKey = getEdgeKey({ start: edge.end, end: edge.start });

        // Check if reverse edge already exists (shared edge)
        if (edgeMap.has(reverseKey)) {
          // Mark as shared (internal) edge
          edgeMap.get(reverseKey).shared = true;
          edge.shared = true;
        }

        edgeMap.set(edgeKey, edge);
        allEdges.push(edge);
      }
    }

    // Filter out shared edges (internal boundaries)
    const outerEdges = allEdges.filter(edge => !edge.shared);

    if (outerEdges.length === 0) {
      console.warn('No outer edges found after filtering shared edges');
      // Fallback: use convex hull
      return computeConvexHull(polygons);
    }

    // Build the outer boundary by walking edges
    const outerBoundary = walkEdges(outerEdges);

    if (outerBoundary && outerBoundary.length >= 3) {
      // Close the ring
      outerBoundary.push(outerBoundary[0].slice());
      return outerBoundary;
    }

    // Fallback: convex hull
    console.warn('Edge walking failed, using convex hull');
    return computeConvexHull(polygons);
  }

  /**
   * Create a unique key for an edge
   */
  function getEdgeKey(edge) {
    return `${edge.start[0].toFixed(6)},${edge.start[1].toFixed(6)}-${edge.end[0].toFixed(6)},${edge.end[1].toFixed(6)}`;
  }

  /**
   * Walk edges to form a closed boundary
   * @param {Array} edges
   * @returns {Array|null} Ordered coordinates
   */
  function walkEdges(edges) {
    if (edges.length === 0) return null;

    // Build adjacency map
    const adjacency = new Map();
    for (const edge of edges) {
      const startKey = `${edge.start[0].toFixed(6)},${edge.start[1].toFixed(6)}`;
      if (!adjacency.has(startKey)) {
        adjacency.set(startKey, []);
      }
      adjacency.get(startKey).push(edge);
    }

    // Start from first edge
    const result = [edges[0].start.slice()];
    let current = edges[0].end.slice();
    const usedEdges = new Set();
    usedEdges.add(getEdgeKey(edges[0]));

    const maxIterations = edges.length * 2;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      result.push(current.slice());

      // Check if we've returned to start
      if (coordsEqual(current, result[0]) && result.length > 3) {
        break;
      }

      // Find next edge
      const currentKey = `${current[0].toFixed(6)},${current[1].toFixed(6)}`;
      const candidates = adjacency.get(currentKey) || [];

      let foundNext = false;
      for (const candidate of candidates) {
        const key = getEdgeKey(candidate);
        if (!usedEdges.has(key)) {
          usedEdges.add(key);
          current = candidate.end.slice();
          foundNext = true;
          break;
        }
      }

      if (!foundNext) {
        break;
      }
    }

    return result.length >= 3 ? result : null;
  }

  /**
   * Compute convex hull of all polygon points as fallback
   * @param {Array} polygons
   * @returns {Array} Convex hull coordinates
   */
  function computeConvexHull(polygons) {
    // Collect all points
    const allPoints = [];
    for (const polygon of polygons) {
      const coords = polygon.getCoordinates()[0];
      for (const coord of coords) {
        allPoints.push(coord);
      }
    }

    // Simple convex hull (Graham scan)
    const hull = grahamScan(allPoints);
    hull.push(hull[0].slice());  // Close the ring
    return hull;
  }

  /**
   * Graham scan convex hull algorithm
   */
  function grahamScan(points) {
    if (points.length < 3) return points;

    // Find bottom-most point (or left-most if tied)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][1] < points[start][1] ||
          (points[i][1] === points[start][1] && points[i][0] < points[start][0])) {
        start = i;
      }
    }

    const startPoint = points[start];

    // Sort by polar angle
    const sorted = points.slice().sort((a, b) => {
      const angleA = Math.atan2(a[1] - startPoint[1], a[0] - startPoint[0]);
      const angleB = Math.atan2(b[1] - startPoint[1], b[0] - startPoint[0]);
      if (angleA !== angleB) return angleA - angleB;
      // If same angle, closer point first
      const distA = (a[0] - startPoint[0]) ** 2 + (a[1] - startPoint[1]) ** 2;
      const distB = (b[0] - startPoint[0]) ** 2 + (b[1] - startPoint[1]) ** 2;
      return distA - distB;
    });

    // Build hull
    const hull = [];
    for (const point of sorted) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }

    return hull;
  }

  /**
   * Cross product for convex hull
   */
  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  /**
   * Confirm the current selection and create red-line boundary
   */
  function confirmSelection() {
    if (selectedPolygons.length === 0) {
      if (onError) {
        onError('No polygons selected. Click on polygons to select them first.', 'warning');
      }
      return false;
    }

    // Validate contiguity if multiple polygons
    if (selectedPolygons.length > 1) {
      if (window.ParcelValidation && window.ParcelValidation.arePolygonsContiguous) {
        const polygonGeoms = selectedPolygons.map(s => geometryToPolygon(s.geometry));
        if (!window.ParcelValidation.arePolygonsContiguous(polygonGeoms)) {
          if (onError) {
            onError('Selected polygons are not all connected. The red-line boundary must be a single contiguous area.', 'error');
          }
          return false;
        }
      }
    }

    // Merge polygons
    const mergedPolygon = mergeSelectedPolygons();

    if (!mergedPolygon) {
      if (onError) {
        onError('Failed to merge selected polygons. Please try again.', 'error');
      }
      return false;
    }

    // Get merged polygon coordinates for SnapDrawing
    const coords = mergedPolygon.getCoordinates()[0];

    console.log('✓ Fill selection confirmed');
    console.log(`Merged polygon has ${coords.length - 1} vertices`);

    // Clear any existing polygon first
    if (window.SnapDrawing && window.SnapDrawing.isPolygonComplete && window.SnapDrawing.isPolygonComplete()) {
      console.log('Clearing existing polygon before setting new one from fill');
      window.SnapDrawing.clearPolygon();
    }

    // Pass to SnapDrawing module to set as the red-line boundary
    if (window.SnapDrawing && window.SnapDrawing.setPolygonFromCoordinates) {
      window.SnapDrawing.setPolygonFromCoordinates(coords);
    } else {
      // Fallback: dispatch custom event with the polygon data
      const event = new CustomEvent('fill-confirmed', {
        detail: {
          geometry: mergedPolygon,
          coordinates: coords,
          area: mergedPolygon.getArea(),
          areaHectares: mergedPolygon.getArea() / 10000
        }
      });
      document.dispatchEvent(event);
    }

    // Exit fill mode
    cancelFillMode();

    if (onConfirm) {
      onConfirm({
        geometry: mergedPolygon,
        coordinates: coords,
        area: mergedPolygon.getArea(),
        areaHectares: mergedPolygon.getArea() / 10000
      });
    }

    return true;
  }

  /**
   * Cancel fill mode and clear selection
   */
  function cancelFillMode() {
    if (!isFillModeActive) {
      return;
    }

    const wasParcelMode = fillMode === 'habitat-parcels';
    
    isFillModeActive = false;
    selectedPolygons = [];
    existingBoundaryGeometry = null;
    constraintBoundary = null;
    previewSource.clear();

    // Remove event handlers based on mode
    if (wasParcelMode) {
      map.un('click', handleFillClickForParcels);
    } else {
      map.un('click', handleFillClick);
    }
    map.un('pointermove', handleFillHover);

    // Reset cursor
    map.getTargetElement().style.cursor = 'default';

    console.log('Fill mode cancelled');

    // Update appropriate UI
    if (wasParcelMode) {
      updateUIForParcelMode();
    } else {
      updateUI();
    }

    if (onSelectionChange) {
      onSelectionChange(getSelectionInfo());
    }
  }

  /**
   * Clear current selection without exiting fill mode
   */
  function clearSelection() {
    selectedPolygons = [];
    existingBoundaryGeometry = null;
    previewSource.clear();
    updateUI();

    if (onSelectionChange) {
      onSelectionChange(getSelectionInfo());
    }
  }

  /**
   * Update UI elements based on current state
   */
  function updateUI() {
    // Update fill-related UI elements
    const startFillBtn = document.getElementById('start-fill');
    const cancelFillBtn = document.getElementById('cancel-fill');
    const confirmFillBtn = document.getElementById('confirm-fill');
    const startDrawBtn = document.getElementById('start-drawing');
    const selectionInfo = document.getElementById('fill-selection-info');
    const selectionCount = document.getElementById('selection-count');
    const selectionArea = document.getElementById('selection-area');

    if (isFillModeActive) {
      // Fill mode active
      if (startFillBtn) startFillBtn.parentElement.style.display = 'none';
      if (startDrawBtn) startDrawBtn.parentElement.style.display = 'none';
      if (cancelFillBtn) cancelFillBtn.parentElement.style.display = 'block';
      if (confirmFillBtn) {
        confirmFillBtn.parentElement.style.display = selectedPolygons.length > 0 ? 'block' : 'none';
      }
      if (selectionInfo) selectionInfo.style.display = 'block';
    } else {
      // Fill mode inactive
      if (startFillBtn) startFillBtn.parentElement.style.display = 'block';
      if (startDrawBtn) startDrawBtn.parentElement.style.display = 'block';
      if (cancelFillBtn) cancelFillBtn.parentElement.style.display = 'none';
      if (confirmFillBtn) confirmFillBtn.parentElement.style.display = 'none';
      if (selectionInfo) selectionInfo.style.display = 'none';
    }

    // Update selection info
    if (selectionCount) {
      selectionCount.textContent = selectedPolygons.length;
    }
    if (selectionArea) {
      const info = getSelectionInfo();
      selectionArea.textContent = info.totalAreaHectares.toFixed(2);
    }
  }

  /**
   * Update UI elements for parcel fill mode
   */
  function updateUIForParcelMode() {
    const startFillParcelBtn = document.getElementById('start-fill-parcel');
    const finishFillParcelBtn = document.getElementById('finish-fill-parcel');
    const startDrawBtn = document.getElementById('start-drawing');
    const startSliceBtn = document.getElementById('start-slice');

    if (isFillModeActive && fillMode === 'habitat-parcels') {
      // Parcel fill mode active
      if (startFillParcelBtn) startFillParcelBtn.parentElement.style.display = 'none';
      if (startDrawBtn) startDrawBtn.parentElement.style.display = 'none';
      if (startSliceBtn) startSliceBtn.parentElement.style.display = 'none';
      if (finishFillParcelBtn) finishFillParcelBtn.parentElement.style.display = 'block';
    } else {
      // Parcel fill mode inactive
      if (startFillParcelBtn) startFillParcelBtn.parentElement.style.display = 'block';
      if (startDrawBtn) startDrawBtn.parentElement.style.display = 'block';
      if (startSliceBtn) startSliceBtn.parentElement.style.display = 'block';
      if (finishFillParcelBtn) finishFillParcelBtn.parentElement.style.display = 'none';
    }
  }

  /**
   * Check if fill mode is currently active
   * @returns {boolean}
   */
  function isActive() {
    return isFillModeActive;
  }

  /**
   * Get current fill mode
   * @returns {string} 'red-line-boundary' or 'habitat-parcels'
   */
  function getMode() {
    return fillMode;
  }

  /**
   * Get count of selected polygons
   * @returns {number}
   */
  function getSelectionCount() {
    return selectedPolygons.length;
  }

  /**
   * Get the merged polygon geometry (without confirming)
   * @returns {ol.geom.Polygon|null}
   */
  function getMergedGeometry() {
    return mergeSelectedPolygons();
  }

  // Export public API
  window.FillTool = {
    init: init,
    startFillMode: startFillMode,
    startFillModeForParcels: startFillModeForParcels,
    cancelFillMode: cancelFillMode,
    confirmSelection: confirmSelection,
    clearSelection: clearSelection,
    isActive: isActive,
    getMode: getMode,
    getSelectionInfo: getSelectionInfo,
    getSelectionCount: getSelectionCount,
    getMergedGeometry: getMergedGeometry
  };

})(window);
