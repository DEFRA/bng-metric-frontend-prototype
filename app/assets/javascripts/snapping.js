//
// Multi-layer snapping polygon drawing module for OS Open Zoomstack
// Supports two modes: 'red-line-boundary' (single polygon) and 'habitat-parcels' (multiple polygons)
//

(function(window) {
  'use strict';

  // Zoomstack feature types - these DO work via Features API!
  const SNAP_LAYERS = [
    'Zoomstack_LocalBuildings',
    'Zoomstack_Greenspace',
    'Zoomstack_RoadsLocal',
    'Zoomstack_RoadsRegional',
    'Zoomstack_RoadsNational',
    'Zoomstack_Waterlines',
    'Zoomstack_Rail',
    'Zoomstack_Woodland',
  ];

  // Use the backend proxy endpoint for OS Features API
  const WFS_ENDPOINT = '/api/os/features';
  const MIN_ZOOM_FOR_SNAP = 14;  // Only fetch at detailed zoom levels
  const FETCH_THROTTLE_MS = 300;
  const SNAP_TOLERANCE_PX = 25;  // Increased for better snapping UX
  const CLOSE_TOLERANCE_PX = 10;
  const SIMPLIFY_TOLERANCE = 0.25;
  const MAX_FEATURES_PER_REQUEST = 100;

  // Parcel colors for habitat parcels mode
  const PARCEL_COLORS = [
    { stroke: 'rgba(29, 112, 184, 1)', fill: 'rgba(29, 112, 184, 0.2)' },    // Blue
    { stroke: 'rgba(0, 112, 60, 1)', fill: 'rgba(0, 112, 60, 0.2)' },        // Green
    { stroke: 'rgba(128, 51, 153, 1)', fill: 'rgba(128, 51, 153, 0.2)' },    // Purple
    { stroke: 'rgba(212, 53, 28, 1)', fill: 'rgba(212, 53, 28, 0.2)' },      // Red
    { stroke: 'rgba(255, 152, 0, 1)', fill: 'rgba(255, 152, 0, 0.2)' },      // Orange
    { stroke: 'rgba(0, 150, 136, 1)', fill: 'rgba(0, 150, 136, 0.2)' },      // Teal
    { stroke: 'rgba(233, 30, 99, 1)', fill: 'rgba(233, 30, 99, 0.2)' },      // Pink
    { stroke: 'rgba(63, 81, 181, 1)', fill: 'rgba(63, 81, 181, 0.2)' },      // Indigo
  ];

  // Module state
  let map = null;
  let snapIndexSource = null;
  let snapIndexLayer = null;
  let drawLayer = null;
  let hoverLayer = null;
  let hoverSource = null;
  let drawSource = null;
  let boundaryLayer = null;
  let boundarySource = null;
  let dragPanInteraction = null;

  // Configuration
  let currentMode = 'red-line-boundary';  // 'red-line-boundary' or 'habitat-parcels'
  let boundaryPolygon = null;  // The boundary geometry for habitat-parcels mode

  // Drawing state
  let isDrawing = false;
  let isEditing = false;
  let polygonComplete = false;
  let currentPolygonCoords = [];
  let placedVertices = [];
  let hoverFeature = null;
  let polygonFeature = null;
  let lastSnapCoord = null;
  let canClosePolygon = false;
  let snappingEnabled = true;
  let boundarySnappingEnabled = true;  // Separate toggle for boundary snapping

  // Habitat parcels mode - multiple polygons
  let habitatParcels = [];  // Array of { feature, coords, vertices, colorIndex }
  let currentParcelIndex = -1;  // Index of parcel being edited, -1 if drawing new

  // Editing state
  let draggedVertex = null;
  let draggedVertexIndex = -1;
  let isDragging = false;
  let justFinishedDragging = false;
  let ghostVertex = null;
  let ghostVertexCoord = null;
  let ghostVertexInsertIndex = -1;

  // Throttling
  let fetchTimeout = null;
  let lastFetchExtent = null;
  let isFetching = false;

  // Callbacks
  let onPolygonComplete = null;
  let onParcelAdded = null;
  let onParcelRemoved = null;
  let onValidationError = null;

  /**
   * Initialize the snapping system with configuration
   * @param {ol.Map} olMap - OpenLayers map instance
   * @param {Object} config - Configuration options
   * @param {string} config.mode - 'red-line-boundary' or 'habitat-parcels'
   * @param {Object} config.boundaryGeoJSON - GeoJSON boundary for habitat-parcels mode
   * @param {Function} config.onPolygonComplete - Callback when polygon is completed
   * @param {Function} config.onParcelAdded - Callback when parcel is added (habitat-parcels mode)
   * @param {Function} config.onParcelRemoved - Callback when parcel is removed (habitat-parcels mode)
   * @param {Function} config.onValidationError - Callback for validation errors
   */
  function initWithConfig(olMap, config = {}) {
    map = olMap;
    currentMode = config.mode || 'red-line-boundary';
    onPolygonComplete = config.onPolygonComplete || null;
    onParcelAdded = config.onParcelAdded || null;
    onParcelRemoved = config.onParcelRemoved || null;
    onValidationError = config.onValidationError || null;

    console.log('=== Snapping System Initializing ===');
    console.log('Mode:', currentMode);
    console.log('Map:', map);
    console.log('Using backend proxy for OS API');
    console.log('Layers to fetch:', SNAP_LAYERS);

    // Check if EPSG:27700 is registered
    const epsg27700 = ol.proj.get('EPSG:27700');
    if (!epsg27700) {
      console.error('❌ EPSG:27700 projection not found!');
      console.error('Make sure proj4 is loaded and EPSG:27700 is registered before initializing snapping.');
      return;
    }
    console.log('✓ EPSG:27700 projection found');

    // Get reference to DragPan interaction for later control
    map.getInteractions().forEach(interaction => {
      if (interaction instanceof ol.interaction.DragPan) {
        dragPanInteraction = interaction;
      }
    });

    setupLayers();
    setupEventHandlers();

    // Load boundary if provided (for habitat-parcels mode)
    if (config.boundaryGeoJSON && currentMode === 'habitat-parcels') {
      loadBoundary(config.boundaryGeoJSON);
    }

    console.log('✓ Snapping system initialized successfully');
    console.log(`Min zoom for snapping: ${MIN_ZOOM_FOR_SNAP}`);
    console.log(`Current zoom: ${map.getView().getZoom()}`);
  }

  /**
   * Initialize the snapping system (legacy method for backwards compatibility)
   * @param {ol.Map} olMap - OpenLayers map instance
   */
  function initSnapping(olMap) {
    initWithConfig(olMap, { mode: 'red-line-boundary' });
  }

  /**
   * Set up the required layers for snapping and drawing
   */
  function setupLayers() {
    // Snap index layer (hidden)
    snapIndexSource = new ol.source.Vector();
    snapIndexLayer = new ol.layer.Vector({
      source: snapIndexSource,
      style: null, // Invisible
      zIndex: 1
    });
    map.addLayer(snapIndexLayer);

    // Boundary layer (for habitat-parcels mode - shows the red line boundary)
    boundarySource = new ol.source.Vector();
    boundaryLayer = new ol.layer.Vector({
      source: boundarySource,
      style: boundaryStyleFunction,
      zIndex: 10
    });
    map.addLayer(boundaryLayer);

    // Hover marker layer (with dynamic styling)
    hoverSource = new ol.source.Vector();
    hoverLayer = new ol.layer.Vector({
      source: hoverSource,
      style: function(feature) {
        const isSnapped = feature.get('isSnapped');
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: isSnapped ? 8 : 6,
            fill: new ol.style.Fill({ 
              color: isSnapped ? 'rgba(255, 165, 0, 0.8)' : 'rgba(0, 150, 255, 0.6)' 
            }),
            stroke: new ol.style.Stroke({ 
              color: 'white', 
              width: isSnapped ? 3 : 2 
            })
          })
        });
      },
      zIndex: 100
    });
    map.addLayer(hoverLayer);

    // Drawing layer (vertices + polygon)
    drawSource = new ol.source.Vector();
    drawLayer = new ol.layer.Vector({
      source: drawSource,
      style: styleFunction,
      zIndex: 50
    });
    map.addLayer(drawLayer);
  }

  /**
   * Style function for the boundary layer (red-line boundary in habitat-parcels mode)
   */
  function boundaryStyleFunction(feature) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'rgba(220, 0, 0, 1)',
        width: 3,
        lineDash: [10, 5]  // Dashed line for boundary
      }),
      fill: null  // No fill - only border
    });
  }

  /**
   * Style function for drawing layer features
   */
  function styleFunction(feature) {
    const type = feature.get('type');
    
    if (type === 'vertex') {
      const isFirst = feature.get('isFirst');
      const isHighlighted = feature.get('highlighted');
      const isHovered = feature.get('hovered');
      const isBeingDragged = feature.get('dragging');
      const colorIndex = feature.get('colorIndex') || 0;
      
      let radius = 5;
      let fillColor = currentMode === 'habitat-parcels' 
        ? PARCEL_COLORS[colorIndex % PARCEL_COLORS.length].stroke 
        : 'rgba(255, 100, 0, 0.8)';
      let strokeColor = 'white';
      let strokeWidth = 2;
      
      if (isBeingDragged) {
        radius = 8;
        fillColor = 'rgba(0, 150, 255, 0.9)';
        strokeColor = 'blue';
        strokeWidth = 3;
      } else if (isHighlighted) {
        radius = 9;
        fillColor = 'rgba(255, 0, 0, 0.9)';
        strokeColor = 'rgba(200, 0, 0, 1)';
        strokeWidth = 3;
      } else if (isHovered && polygonComplete) {
        radius = 7;
        fillColor = 'rgba(255, 150, 0, 0.9)';
        strokeColor = 'rgba(255, 200, 0, 1)';
        strokeWidth = 2;
      }
      
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: radius,
          fill: new ol.style.Fill({ color: fillColor }),
          stroke: new ol.style.Stroke({ 
            color: strokeColor,
            width: strokeWidth
          })
        }),
        zIndex: isBeingDragged ? 300 : (isFirst ? 200 : 100)
      });
    } else if (type === 'polygon' || type === 'parcel') {
      const colorIndex = feature.get('colorIndex') || 0;
      
      if (currentMode === 'habitat-parcels') {
        const colors = PARCEL_COLORS[colorIndex % PARCEL_COLORS.length];
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: colors.stroke,
            width: 3
          }),
          fill: new ol.style.Fill({
            color: colors.fill
          })
        });
      } else {
        // Red-line boundary mode
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: 'rgba(220, 0, 0, 1)',
            width: 3
          }),
          fill: new ol.style.Fill({
            color: 'rgba(220, 0, 0, 0.15)'
          })
        });
      }
    } else if (type === 'ghost-vertex') {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.8)' }),
          stroke: new ol.style.Stroke({ 
            color: currentMode === 'habitat-parcels' ? 'rgba(29, 112, 184, 1)' : 'rgba(220, 0, 0, 1)',
            width: 2
          })
        }),
        zIndex: 150
      });
    }
  }

  /**
   * Load boundary polygon for habitat-parcels mode
   * @param {Object} geojson - GeoJSON feature for the boundary
   */
  function loadBoundary(geojson) {
    if (!geojson || currentMode !== 'habitat-parcels') {
      console.warn('loadBoundary called but not in habitat-parcels mode or no geojson provided');
      return;
    }

    console.log('Loading boundary polygon...');

    try {
      const format = new ol.format.GeoJSON();
      
      // Determine source projection from GeoJSON CRS or default to EPSG:3857
      let dataProjection = 'EPSG:3857';
      if (geojson.crs && geojson.crs.properties && geojson.crs.properties.name) {
        dataProjection = geojson.crs.properties.name;
      }

      const feature = format.readFeature(geojson, {
        dataProjection: dataProjection,
        featureProjection: 'EPSG:3857'
      });

      feature.set('type', 'boundary');
      boundarySource.clear();
      boundarySource.addFeature(feature);

      // Store the boundary polygon geometry for validation
      boundaryPolygon = feature.getGeometry();

      // Zoom to boundary extent with padding
      const extent = boundaryPolygon.getExtent();
      map.getView().fit(extent, {
        padding: [50, 50, 50, 50],
        duration: 500,
        maxZoom: 16
      });

      console.log('✓ Boundary loaded and map zoomed to fit');
    } catch (error) {
      console.error('❌ Error loading boundary:', error);
    }
  }

  /**
   * Set up event handlers for map interactions
   */
  function setupEventHandlers() {
    const view = map.getView();

    console.log('[setupEventHandlers] Attaching event handlers to map');

    // View change handlers - fetch snap data when map moves/zooms
    view.on('change:center', throttledFetchSnapData);
    view.on('change:resolution', throttledFetchSnapData);

    // Mouse move handler - update hover marker and live polygon
    map.on('pointermove', handlePointerMove);

    // Click handler - place vertex or close polygon
    map.on('click', handleSingleClick);

    // Drag handlers for editing
    map.on('pointerdown', handlePointerDown);
    map.on('pointerup', handlePointerUp);

    console.log('[setupEventHandlers] Event handlers attached');
    console.log('[setupEventHandlers] Triggering initial fetch');

    // Initial fetch
    throttledFetchSnapData();
  }

  /**
   * Throttled fetch for snap data
   */
  function throttledFetchSnapData() {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }

    fetchTimeout = setTimeout(() => {
      fetchSnapData();
    }, FETCH_THROTTLE_MS);
  }

  /**
   * Fetch WFS data for snapping
   */
  async function fetchSnapData() {
    const zoom = map.getView().getZoom();
    
    if (zoom < MIN_ZOOM_FOR_SNAP) {
      console.log(`⚠️  Zoom too low (${zoom.toFixed(1)} < ${MIN_ZOOM_FOR_SNAP}) - snapping disabled`);
      snapIndexSource.clear();
      return;
    }

    if (isFetching) {
      return;
    }

    const extent = map.getView().calculateExtent(map.getSize());
    
    if (lastFetchExtent && ol.extent.equals(extent, lastFetchExtent)) {
      return;
    }

    lastFetchExtent = extent;
    isFetching = true;

    try {
      snapIndexSource.clear();

      const fetchPromises = SNAP_LAYERS.map(typeName => 
        fetchLayerData(typeName, extent)
      );

      const results = await Promise.allSettled(fetchPromises);
      
      const allFeatures = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allFeatures.push(...result.value);
        }
      });

      if (allFeatures.length > 0) {
        snapIndexSource.addFeatures(allFeatures);
        console.log(`✅ Loaded ${allFeatures.length} snap features - snapping is now active!`);
      }
    } catch (error) {
      console.error('❌ Error fetching snap data:', error);
    } finally {
      isFetching = false;
    }
  }

  /**
   * Fetch a single layer's data with pagination
   */
  async function fetchLayerData(typeName, extent) {
    const features = [];
    let startIndex = 0;
    let hasMore = true;

    let minCoord, maxCoord, bbox;
    
    try {
      minCoord = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:27700');
      maxCoord = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:27700');
      bbox = `${minCoord[0]},${minCoord[1]},${maxCoord[0]},${maxCoord[1]}`;
    } catch (error) {
      console.error(`❌ Failed to transform coordinates for ${typeName}:`, error);
      return [];
    }

    while (hasMore && startIndex < 1000) {
      const url = `${WFS_ENDPOINT}?` +
        `typeNames=${typeName}` +
        `&srsName=EPSG:27700` +
        `&outputFormat=GEOJSON` +
        `&bbox=${bbox},EPSG:27700` +
        `&count=${MAX_FEATURES_PER_REQUEST}` +
        `&startIndex=${startIndex}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const geojson = await response.json();
        
        if (geojson.features && geojson.features.length > 0) {
          const format = new ol.format.GeoJSON();
          const olFeatures = format.readFeatures(geojson, {
            dataProjection: 'EPSG:27700',
            featureProjection: 'EPSG:3857'
          });

          olFeatures.forEach(feature => {
            const geom = feature.getGeometry();
            if (geom) {
              const simplified = geom.simplify(SIMPLIFY_TOLERANCE);
              feature.setGeometry(simplified);
              feature.set('layerType', typeName);
            }
          });

          features.push(...olFeatures);

          if (geojson.features.length < MAX_FEATURES_PER_REQUEST) {
            hasMore = false;
          } else {
            startIndex += MAX_FEATURES_PER_REQUEST;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        hasMore = false;
      }
    }

    return features;
  }

  /**
   * Handle pointer move - update hover marker and live polygon
   */
  function handlePointerMove(evt) {
    if (evt.dragging && !isDragging) {
      return;
    }

    const coordinate = evt.coordinate;
    const snapCoord = findSnapPoint(coordinate);
    lastSnapCoord = snapCoord;

    if (isDragging && draggedVertex) {
      updateDraggedVertex(snapCoord);
      return;
    }

    const didSnap = coordinate[0] !== snapCoord[0] || coordinate[1] !== snapCoord[1];

    if (isDrawing) {
      updateHoverMarker(snapCoord, didSnap);
    }

    if (isDrawing && currentPolygonCoords.length > 0) {
      updateLivePolygon(snapCoord);
    }

    if (isDrawing && currentPolygonCoords.length >= 3) {
      checkFirstVertexHover(evt.pixel);
    }

    if (polygonComplete && !isDrawing) {
      checkVertexHover(evt.pixel);
      
      if (!isOverVertex(evt.pixel)) {
        checkPolygonEdgeHover(evt.pixel, snapCoord);
      } else {
        clearGhostVertex();
      }
    } else {
      clearGhostVertex();
    }

    // Update cursor
    let cursor = 'default';
    if (isDrawing) {
      cursor = 'crosshair';
    } else if (isDragging) {
      cursor = 'grabbing';
    } else if (polygonComplete && isOverVertex(evt.pixel)) {
      cursor = 'grab';
    } else if (polygonComplete && ghostVertex) {
      cursor = 'copy';
    }
    map.getTargetElement().style.cursor = cursor;
  }

  /**
   * Find the nearest snap point
   * Checks OS features (if enabled), boundary (if enabled), and existing parcels (always in habitat-parcels mode)
   */
  function findSnapPoint(coordinate) {
    let minDistance = Infinity;
    let snapPoint = null;

    const pixelTolerance = SNAP_TOLERANCE_PX;
    const resolution = map.getView().getResolution();
    const tolerance = pixelTolerance * resolution;
    const vertexTolerance = tolerance * 0.5;

    // 1. Check OS features (if snapping enabled)
    if (snappingEnabled) {
      const features = snapIndexSource.getFeatures();
      
      // Check feature edges
      features.forEach(feature => {
        const geom = feature.getGeometry();
        if (!geom) return;

        const type = geom.getType();

        if (type === 'LineString') {
          const pt = geom.getClosestPoint(coordinate);
          const dist = getDistance(coordinate, pt);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            snapPoint = pt;
          }
        } else if (type === 'MultiLineString') {
          geom.getLineStrings().forEach(line => {
            const pt = line.getClosestPoint(coordinate);
            const dist = getDistance(coordinate, pt);
            if (dist < minDistance && dist < tolerance) {
              minDistance = dist;
              snapPoint = pt;
            }
          });
        } else if (type === 'Polygon') {
          const ring = geom.getLinearRing(0);
          const pt = ring.getClosestPoint(coordinate);
          const dist = getDistance(coordinate, pt);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            snapPoint = pt;
          }
        } else if (type === 'MultiPolygon') {
          geom.getPolygons().forEach(poly => {
            const ring = poly.getLinearRing(0);
            const pt = ring.getClosestPoint(coordinate);
            const dist = getDistance(coordinate, pt);
            if (dist < minDistance && dist < tolerance) {
              minDistance = dist;
              snapPoint = pt;
            }
          });
        }
      });

      // Check OS feature vertices (higher priority)
      features.forEach(feature => {
        const geom = feature.getGeometry();
        if (!geom) return;

        const type = geom.getType();
        const coords = geom.getCoordinates();
        const vertices = flattenCoordinates(coords, type);
        
        vertices.forEach(vertex => {
          const distance = getDistance(coordinate, vertex);
          if (distance < minDistance && distance < vertexTolerance) {
            minDistance = distance;
            snapPoint = vertex;
          }
        });
      });
    }

    // 2. Check boundary polygon (if boundary snapping enabled and in habitat-parcels mode)
    if (boundarySnappingEnabled && currentMode === 'habitat-parcels' && boundaryPolygon) {
      // Snap to boundary edges
      const ring = boundaryPolygon.getLinearRing(0);
      const pt = ring.getClosestPoint(coordinate);
      const dist = getDistance(coordinate, pt);
      if (dist < minDistance && dist < tolerance) {
        minDistance = dist;
        snapPoint = pt;
      }

      // Snap to boundary vertices (higher priority)
      const boundaryCoords = boundaryPolygon.getCoordinates()[0];
      boundaryCoords.forEach(vertex => {
        const distance = getDistance(coordinate, vertex);
        if (distance < minDistance && distance < vertexTolerance) {
          minDistance = distance;
          snapPoint = vertex;
        }
      });
    }

    // 3. Always snap to existing habitat parcels in habitat-parcels mode
    if (currentMode === 'habitat-parcels' && habitatParcels.length > 0) {
      habitatParcels.forEach(parcel => {
        const parcelGeom = parcel.feature.getGeometry();
        if (!parcelGeom) return;

        // Snap to parcel edges
        const ring = parcelGeom.getLinearRing(0);
        const pt = ring.getClosestPoint(coordinate);
        const dist = getDistance(coordinate, pt);
        if (dist < minDistance && dist < tolerance) {
          minDistance = dist;
          snapPoint = pt;
        }

        // Snap to parcel vertices (higher priority)
        const parcelCoords = parcelGeom.getCoordinates()[0];
        parcelCoords.forEach(vertex => {
          const distance = getDistance(coordinate, vertex);
          if (distance < minDistance && distance < vertexTolerance) {
            minDistance = distance;
            snapPoint = vertex;
          }
        });
      });
    }

    return snapPoint || coordinate;
  }

  /**
   * Flatten coordinates to get all vertices
   */
  function flattenCoordinates(coords, geomType) {
    const vertices = [];
    
    if (geomType === 'LineString') {
      return coords;
    } else if (geomType === 'MultiLineString' || geomType === 'Polygon') {
      coords.forEach(ring => {
        vertices.push(...ring);
      });
    } else if (geomType === 'MultiPolygon') {
      coords.forEach(poly => {
        poly.forEach(ring => {
          vertices.push(...ring);
        });
      });
    }
    
    return vertices;
  }

  /**
   * Calculate distance between two coordinates
   */
  function getDistance(coord1, coord2) {
    const dx = coord2[0] - coord1[0];
    const dy = coord2[1] - coord1[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Update hover marker position
   */
  function updateHoverMarker(coordinate, isSnapped) {
    hoverSource.clear();
    
    if (isDrawing) {
      hoverFeature = new ol.Feature({
        geometry: new ol.geom.Point(coordinate),
        isSnapped: isSnapped || false
      });
      hoverSource.addFeature(hoverFeature);
    }
  }

  /**
   * Update live polygon while drawing
   */
  function updateLivePolygon(snapCoord) {
    const tempCoords = [...currentPolygonCoords, snapCoord];
    
    if (tempCoords.length >= 2) {
      if (polygonFeature) {
        drawSource.removeFeature(polygonFeature);
      }

      let geom;
      if (tempCoords.length === 2) {
        geom = new ol.geom.LineString(tempCoords);
      } else {
        geom = new ol.geom.Polygon([tempCoords]);
      }

      const colorIndex = currentMode === 'habitat-parcels' ? habitatParcels.length : 0;

      polygonFeature = new ol.Feature({
        geometry: geom,
        type: 'polygon',
        colorIndex: colorIndex
      });
      drawSource.addFeature(polygonFeature);
    }
  }

  /**
   * Check if hovering over first vertex
   */
  function checkFirstVertexHover(pixel) {
    if (placedVertices.length === 0) {
      canClosePolygon = false;
      return;
    }

    const firstVertex = placedVertices[0];
    const firstCoord = firstVertex.getGeometry().getCoordinates();
    const firstPixel = map.getPixelFromCoordinate(firstCoord);
    
    const distance = Math.sqrt(
      Math.pow(pixel[0] - firstPixel[0], 2) + 
      Math.pow(pixel[1] - firstPixel[1], 2)
    );

    if (distance <= CLOSE_TOLERANCE_PX) {
      if (!canClosePolygon) {
        canClosePolygon = true;
        firstVertex.set('highlighted', true);
        firstVertex.changed();
      }
    } else {
      if (canClosePolygon) {
        canClosePolygon = false;
        firstVertex.set('highlighted', false);
        firstVertex.changed();
      }
    }
  }

  /**
   * Start drawing mode (called by UI button)
   */
  function startDrawing() {
    if (isDrawing) {
      console.warn('Already in drawing mode');
      return;
    }

    // In red-line-boundary mode, only allow one polygon
    if (currentMode === 'red-line-boundary' && polygonComplete) {
      console.warn('⚠️  A polygon already exists. Clear it first before drawing a new one.');
      return;
    }

    // In habitat-parcels mode, check if there's a boundary
    if (currentMode === 'habitat-parcels' && !boundaryPolygon) {
      console.warn('⚠️  No boundary loaded. Cannot draw parcels without a boundary.');
      if (onValidationError) {
        onValidationError('No boundary loaded. Please define a red line boundary first.');
      }
      return;
    }

    isDrawing = true;
    currentPolygonCoords = [];
    placedVertices = [];
    canClosePolygon = false;
    polygonComplete = false;
    currentParcelIndex = -1;

    console.log('✏️  Drawing mode started');
  }

  /**
   * Handle click to place vertex or close polygon
   */
  function handleSingleClick(evt) {
    if (isDragging || justFinishedDragging || !isDrawing) {
      return;
    }

    if (canClosePolygon && currentPolygonCoords.length >= 3) {
      closePolygon();
      return;
    }

    const snapCoord = lastSnapCoord || evt.coordinate;
    const isFirstVertex = currentPolygonCoords.length === 0;
    placeVertex(snapCoord, isFirstVertex);
  }

  /**
   * Place a vertex at the given coordinate
   */
  function placeVertex(coordinate, isFirst) {
    currentPolygonCoords.push([...coordinate]);

    const colorIndex = currentMode === 'habitat-parcels' ? habitatParcels.length : 0;

    const vertexFeature = new ol.Feature({
      geometry: new ol.geom.Point(coordinate),
      type: 'vertex',
      isFirst: isFirst,
      highlighted: false,
      colorIndex: colorIndex
    });

    placedVertices.push(vertexFeature);
    drawSource.addFeature(vertexFeature);

    console.log(`Vertex placed (${currentPolygonCoords.length}):`, coordinate);
  }

  /**
   * Close the polygon and finish drawing
   * Note: Validation is NOT performed here - user can edit after closing.
   * Validation happens when saving parcels.
   */
  function closePolygon() {
    if (currentPolygonCoords.length < 3) {
      return;
    }

    // Close the ring
    const firstCoord = currentPolygonCoords[0];
    currentPolygonCoords.push([...firstCoord]);

    // Create the completed polygon geometry
    const completedPolygon = new ol.geom.Polygon([currentPolygonCoords]);

    // Update polygon feature
    if (polygonFeature) {
      drawSource.removeFeature(polygonFeature);
    }

    const colorIndex = currentMode === 'habitat-parcels' ? habitatParcels.length : 0;

    polygonFeature = new ol.Feature({
      geometry: completedPolygon,
      type: currentMode === 'habitat-parcels' ? 'parcel' : 'polygon',
      colorIndex: colorIndex
    });
    drawSource.addFeature(polygonFeature);

    hoverSource.clear();

    if (placedVertices.length > 0) {
      placedVertices[0].set('highlighted', false);
      placedVertices[0].changed();
    }

    isDrawing = false;
    canClosePolygon = false;
    polygonComplete = true;
    isEditing = true;

    console.log('✅ Polygon closed:', currentPolygonCoords.length - 1, 'vertices');

    // In habitat-parcels mode, store the parcel and allow drawing more
    if (currentMode === 'habitat-parcels') {
      const parcel = {
        feature: polygonFeature,
        coords: [...currentPolygonCoords],
        vertices: [...placedVertices],
        colorIndex: colorIndex
      };
      habitatParcels.push(parcel);
      currentParcelIndex = habitatParcels.length - 1;

      console.log(`✅ Parcel ${habitatParcels.length} added`);

      // Check for validation warnings (but don't prevent adding)
      const validationResult = validateParcel(completedPolygon, habitatParcels.length - 1);
      if (!validationResult.valid) {
        console.warn('⚠️ Parcel has validation issues:', validationResult.error);
        if (onValidationError) {
          onValidationError(`Warning: ${validationResult.error} You can edit the parcel before saving.`);
        }
      }

      // Reset for next parcel
      polygonComplete = false;
      isEditing = false;
      polygonFeature = null;
      currentPolygonCoords = [];
      placedVertices = [];

      updateUIForHabitatParcels();

      if (onParcelAdded) {
        onParcelAdded(parcel, habitatParcels.length - 1);
      }
    } else {
      updateUIForCompletePolygon();
    }

    updateAreaDisplay();

    if (onPolygonComplete) {
      onPolygonComplete();
    }
  }

  /**
   * Validate a parcel polygon against boundary and existing parcels
   * @param {ol.geom.Polygon} parcelGeom - The polygon to validate
   * @param {number} skipIndex - Index of parcel to skip (when validating itself)
   * @returns {Object} { valid: boolean, error: string|null }
   */
  function validateParcel(parcelGeom, skipIndex = -1) {
    // Check if parcel is within boundary
    if (boundaryPolygon) {
      if (!isPolygonWithinBoundary(parcelGeom, boundaryPolygon)) {
        return {
          valid: false,
          error: 'The parcel must be completely within the red line boundary.'
        };
      }
    }

    // Check for overlap with existing parcels (skip self if editing)
    for (let i = 0; i < habitatParcels.length; i++) {
      if (i === skipIndex) continue;  // Skip self
      
      const existingParcel = habitatParcels[i];
      if (doPolygonsOverlap(parcelGeom, existingParcel.feature.getGeometry())) {
        return {
          valid: false,
          error: `The parcel overlaps with parcel ${i + 1}. Parcels must not overlap.`
        };
      }
    }

    return { valid: true, error: null };
  }

  /**
   * Validate all habitat parcels before saving
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateAllParcels() {
    const errors = [];

    for (let i = 0; i < habitatParcels.length; i++) {
      const parcel = habitatParcels[i];
      const parcelGeom = parcel.feature.getGeometry();

      // Check if parcel is within boundary
      if (boundaryPolygon && !isPolygonWithinBoundary(parcelGeom, boundaryPolygon)) {
        errors.push(`Parcel ${i + 1} extends outside the red line boundary.`);
      }

      // Check for overlap with other parcels
      for (let j = i + 1; j < habitatParcels.length; j++) {
        const otherParcel = habitatParcels[j];
        if (doPolygonsOverlap(parcelGeom, otherParcel.feature.getGeometry())) {
          errors.push(`Parcel ${i + 1} overlaps with parcel ${j + 1}.`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Check if a polygon is completely within another polygon (boundary)
   * @param {ol.geom.Polygon} innerPolygon - The polygon to check
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon
   * @returns {boolean}
   */
  function isPolygonWithinBoundary(innerPolygon, outerPolygon) {
    // Get all coordinates of the inner polygon
    const innerCoords = innerPolygon.getCoordinates()[0];
    
    // Check that every vertex of the inner polygon is inside the outer polygon
    for (let i = 0; i < innerCoords.length - 1; i++) {
      const coord = innerCoords[i];
      if (!outerPolygon.intersectsCoordinate(coord)) {
        return false;
      }
    }

    // Additionally check that the inner polygon doesn't extend outside
    // by checking if the intersection equals the inner polygon
    const innerExtent = innerPolygon.getExtent();
    const outerExtent = outerPolygon.getExtent();
    
    // Quick extent check first
    if (!ol.extent.containsExtent(outerExtent, innerExtent)) {
      return false;
    }

    return true;
  }

  /**
   * Check if two polygons overlap
   * @param {ol.geom.Polygon} polygon1 
   * @param {ol.geom.Polygon} polygon2 
   * @returns {boolean}
   */
  function doPolygonsOverlap(polygon1, polygon2) {
    // Quick extent check first
    const extent1 = polygon1.getExtent();
    const extent2 = polygon2.getExtent();
    
    if (!ol.extent.intersects(extent1, extent2)) {
      return false;
    }

    // Check if any vertex of polygon1 is inside polygon2
    const coords1 = polygon1.getCoordinates()[0];
    for (let i = 0; i < coords1.length - 1; i++) {
      // Check if point is strictly inside (not on boundary)
      if (isPointInsidePolygon(coords1[i], polygon2)) {
        return true;
      }
    }

    // Check if any vertex of polygon2 is inside polygon1
    const coords2 = polygon2.getCoordinates()[0];
    for (let i = 0; i < coords2.length - 1; i++) {
      if (isPointInsidePolygon(coords2[i], polygon1)) {
        return true;
      }
    }

    // Check for edge intersections
    if (doPolygonEdgesIntersect(polygon1, polygon2)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a point is inside a polygon (not on the boundary)
   */
  function isPointInsidePolygon(point, polygon) {
    // Use ray casting algorithm
    const coords = polygon.getCoordinates()[0];
    const x = point[0];
    const y = point[1];
    let inside = false;

    for (let i = 0, j = coords.length - 2; i < coords.length - 1; j = i++) {
      const xi = coords[i][0], yi = coords[i][1];
      const xj = coords[j][0], yj = coords[j][1];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Check if edges of two polygons intersect
   */
  function doPolygonEdgesIntersect(polygon1, polygon2) {
    const coords1 = polygon1.getCoordinates()[0];
    const coords2 = polygon2.getCoordinates()[0];

    for (let i = 0; i < coords1.length - 1; i++) {
      const a1 = coords1[i];
      const a2 = coords1[i + 1];

      for (let j = 0; j < coords2.length - 1; j++) {
        const b1 = coords2[j];
        const b2 = coords2[j + 1];

        if (doLineSegmentsIntersect(a1, a2, b1, b2)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if two line segments intersect (excluding endpoints touching)
   */
  function doLineSegmentsIntersect(a1, a2, b1, b2) {
    const d1 = direction(b1, b2, a1);
    const d2 = direction(b1, b2, a2);
    const d3 = direction(a1, a2, b1);
    const d4 = direction(a1, a2, b2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }

    return false;
  }

  /**
   * Helper for line segment intersection
   */
  function direction(p1, p2, p3) {
    return (p3[0] - p1[0]) * (p2[1] - p1[1]) - (p2[0] - p1[0]) * (p3[1] - p1[1]);
  }

  /**
   * Get the drawn polygon as GeoJSON (for red-line-boundary mode)
   * @returns {Object|null} GeoJSON Polygon in EPSG:3857
   */
  function getDrawnPolygonGeoJSON() {
    if (currentMode === 'habitat-parcels') {
      console.warn('Use getHabitatParcelsGeoJSON() for habitat-parcels mode');
      return null;
    }

    if (currentPolygonCoords.length < 4) {
      return null;
    }

    const coords = [...currentPolygonCoords];
    const first = coords[0];
    const last = coords[coords.length - 1];
    
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([...first]);
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      },
      properties: {},
      crs: {
        type: 'name',
        properties: {
          name: 'EPSG:3857'
        }
      }
    };
  }

  /**
   * Get all habitat parcels as GeoJSON FeatureCollection
   * @returns {Object} GeoJSON FeatureCollection
   */
  function getHabitatParcelsGeoJSON() {
    const features = habitatParcels.map((parcel, index) => {
      const coords = [...parcel.coords];
      const first = coords[0];
      const last = coords[coords.length - 1];
      
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([...first]);
      }

      // Calculate area
      const geom = parcel.feature.getGeometry();
      const areaSqMeters = geom.getArea();
      const areaHectares = areaSqMeters / 10000;

      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        },
        properties: {
          parcelIndex: index,
          areaHectares: areaHectares,
          areaSqMeters: areaSqMeters
        }
      };
    });

    return {
      type: 'FeatureCollection',
      features: features,
      crs: {
        type: 'name',
        properties: {
          name: 'EPSG:3857'
        }
      }
    };
  }

  /**
   * Handle pointer down - start dragging vertex
   */
  function handlePointerDown(evt) {
    if (!polygonComplete || isDrawing) {
      return;
    }

    if (ghostVertex && ghostVertexCoord && ghostVertexInsertIndex >= 0) {
      insertNewVertex(ghostVertexCoord, ghostVertexInsertIndex);
      clearGhostVertex();
      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    const feature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    if (feature) {
      draggedVertex = feature;
      draggedVertexIndex = placedVertices.indexOf(feature);
      isDragging = true;
      
      feature.set('dragging', true);
      feature.changed();
      
      if (dragPanInteraction) {
        dragPanInteraction.setActive(false);
      }
      
      evt.stopPropagation();
      evt.preventDefault();
    }
  }

  /**
   * Handle pointer up - finish dragging vertex
   */
  function handlePointerUp(evt) {
    if (!isDragging || !draggedVertex) {
      return;
    }

    draggedVertex.set('dragging', false);
    draggedVertex.changed();
    
    if (dragPanInteraction) {
      dragPanInteraction.setActive(true);
    }
    
    isDragging = false;
    draggedVertex = null;
    draggedVertexIndex = -1;
    
    justFinishedDragging = true;
    setTimeout(() => {
      justFinishedDragging = false;
    }, 50);
  }

  /**
   * Update the position of the dragged vertex
   */
  function updateDraggedVertex(snapCoord) {
    if (!draggedVertex || draggedVertexIndex < 0) {
      return;
    }

    draggedVertex.getGeometry().setCoordinates(snapCoord);
    currentPolygonCoords[draggedVertexIndex] = [...snapCoord];
    
    if (draggedVertexIndex === 0) {
      currentPolygonCoords[currentPolygonCoords.length - 1] = [...snapCoord];
    } else if (draggedVertexIndex === currentPolygonCoords.length - 1) {
      currentPolygonCoords[0] = [...snapCoord];
      placedVertices[0].getGeometry().setCoordinates(snapCoord);
    }

    if (polygonFeature) {
      polygonFeature.getGeometry().setCoordinates([currentPolygonCoords]);
    }
    
    updateAreaDisplay();
  }

  /**
   * Check if hovering over any vertex in edit mode
   */
  function checkVertexHover(pixel) {
    placedVertices.forEach(v => {
      if (v.get('hovered')) {
        v.set('hovered', false);
        v.changed();
      }
    });

    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    if (feature) {
      feature.set('hovered', true);
      feature.changed();
    }
  }

  /**
   * Check if cursor is over a vertex
   */
  function isOverVertex(pixel) {
    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    return !!feature;
  }

  /**
   * Check if hovering over polygon edge and show ghost vertex
   */
  function checkPolygonEdgeHover(pixel, snapCoord) {
    if (!polygonFeature || !polygonComplete) {
      clearGhostVertex();
      return;
    }

    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      if (feature.get('type') === 'polygon' || feature.get('type') === 'parcel') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    if (feature) {
      const geometry = feature.getGeometry();
      const ring = geometry.getCoordinates()[0];
      
      let minDistance = Infinity;
      let closestPoint = null;
      let insertIndex = -1;

      for (let i = 0; i < ring.length - 1; i++) {
        const start = ring[i];
        const end = ring[i + 1];
        
        const line = new ol.geom.LineString([start, end]);
        const closestOnSegment = line.getClosestPoint(snapCoord);
        const distance = getDistance(snapCoord, closestOnSegment);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = closestOnSegment;
          insertIndex = i + 1;
        }
      }

      if (closestPoint && minDistance < 50) {
        showGhostVertex(closestPoint, insertIndex);
      } else {
        clearGhostVertex();
      }
    } else {
      clearGhostVertex();
    }
  }

  /**
   * Show a ghost vertex at the given position
   */
  function showGhostVertex(coordinate, insertIndex) {
    clearGhostVertex();

    ghostVertexCoord = coordinate;
    ghostVertexInsertIndex = insertIndex;

    ghostVertex = new ol.Feature({
      geometry: new ol.geom.Point(coordinate),
      type: 'ghost-vertex'
    });

    drawSource.addFeature(ghostVertex);
  }

  /**
   * Clear the ghost vertex
   */
  function clearGhostVertex() {
    if (ghostVertex) {
      drawSource.removeFeature(ghostVertex);
      ghostVertex = null;
      ghostVertexCoord = null;
      ghostVertexInsertIndex = -1;
    }
  }

  /**
   * Insert a new vertex at the specified position
   */
  function insertNewVertex(coordinate, insertIndex) {
    console.log(`➕ Inserting new vertex at index ${insertIndex}`);

    currentPolygonCoords.splice(insertIndex, 0, [...coordinate]);

    const colorIndex = polygonFeature ? polygonFeature.get('colorIndex') : 0;

    const newVertexFeature = new ol.Feature({
      geometry: new ol.geom.Point(coordinate),
      type: 'vertex',
      isFirst: false,
      highlighted: false,
      hovered: false,
      colorIndex: colorIndex
    });

    placedVertices.splice(insertIndex, 0, newVertexFeature);
    drawSource.addFeature(newVertexFeature);

    placedVertices.forEach((v, idx) => {
      v.set('isFirst', idx === 0);
    });

    currentPolygonCoords[currentPolygonCoords.length - 1] = [...currentPolygonCoords[0]];

    if (polygonFeature) {
      polygonFeature.getGeometry().setCoordinates([currentPolygonCoords]);
    }

    updateAreaDisplay();
  }

  /**
   * Update UI buttons when polygon is complete (red-line-boundary mode)
   */
  function updateUIForCompletePolygon() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const clearButton = document.getElementById('clear-polygon');
    const saveButton = document.getElementById('save-boundary');
    
    if (startButton) startButton.style.display = 'none';
    if (cancelButton) cancelButton.style.display = 'none';
    if (clearButton) clearButton.style.display = 'inline-block';
    if (saveButton) saveButton.disabled = false;
  }

  /**
   * Update UI for habitat-parcels mode
   */
  function updateUIForHabitatParcels() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const saveParcelsButton = document.getElementById('save-parcels');
    
    if (startButton) startButton.style.display = 'inline-block';
    if (cancelButton) cancelButton.style.display = 'none';
    if (saveParcelsButton) saveParcelsButton.disabled = habitatParcels.length === 0;

    updateParcelsList();
    updateTotalArea();
  }

  /**
   * Update the parcels list UI
   */
  function updateParcelsList() {
    const listElement = document.getElementById('parcels-list-items');
    if (!listElement) return;

    if (habitatParcels.length === 0) {
      listElement.innerHTML = '<li class="govuk-body-s" style="color: #505a5f;">No parcels drawn yet</li>';
      return;
    }

    listElement.innerHTML = habitatParcels.map((parcel, index) => {
      const geom = parcel.feature.getGeometry();
      const areaSqMeters = geom.getArea();
      const areaHectares = (areaSqMeters / 10000).toFixed(2);
      const colors = PARCEL_COLORS[parcel.colorIndex % PARCEL_COLORS.length];

      return `
        <li class="govuk-body-s" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #b1b4b6;">
          <span style="display: flex; align-items: center;">
            <span style="width: 16px; height: 16px; background: ${colors.fill}; border: 2px solid ${colors.stroke}; margin-right: 8px;"></span>
            Parcel ${index + 1}: ${areaHectares} ha
          </span>
          <button type="button" class="govuk-link" style="color: #d4351c; cursor: pointer; border: none; background: none;" onclick="window.SnapDrawing.removeParcel(${index})">
            Remove
          </button>
        </li>
      `;
    }).join('');
  }

  /**
   * Update total area display
   */
  function updateTotalArea() {
    const totalAreaElement = document.getElementById('total-area');
    if (!totalAreaElement) return;

    const totalArea = habitatParcels.reduce((sum, parcel) => {
      const geom = parcel.feature.getGeometry();
      return sum + geom.getArea();
    }, 0);

    const totalHectares = (totalArea / 10000).toFixed(2);
    totalAreaElement.textContent = totalHectares;
  }

  /**
   * Remove a parcel by index
   * @param {number} index - Index of parcel to remove
   */
  function removeParcel(index) {
    if (index < 0 || index >= habitatParcels.length) {
      console.warn('Invalid parcel index:', index);
      return;
    }

    const parcel = habitatParcels[index];

    // Remove feature from map
    drawSource.removeFeature(parcel.feature);

    // Remove vertices from map
    parcel.vertices.forEach(v => {
      drawSource.removeFeature(v);
    });

    // Remove from array
    habitatParcels.splice(index, 1);

    console.log(`🗑️ Parcel ${index + 1} removed`);

    updateUIForHabitatParcels();

    if (onParcelRemoved) {
      onParcelRemoved(index);
    }
  }

  /**
   * Calculate and display polygon area
   */
  function updateAreaDisplay() {
    const areaDisplay = document.getElementById('area-display');
    const areaValue = document.getElementById('area-value');
    const areaAcres = document.getElementById('area-acres');
    
    if (!areaDisplay || !areaValue || !areaAcres) {
      return;
    }

    if (currentMode === 'habitat-parcels') {
      // In habitat parcels mode, show area during drawing
      if (isDrawing && currentPolygonCoords.length >= 3) {
        const tempPolygon = new ol.geom.Polygon([[...currentPolygonCoords, currentPolygonCoords[0]]]);
        const areaSqMeters = tempPolygon.getArea();
        const areaHectares = areaSqMeters / 10000;
        const areaInAcres = areaSqMeters / 4046.86;
        
        areaValue.textContent = areaHectares.toFixed(2);
        areaAcres.textContent = areaInAcres.toFixed(2);
        areaDisplay.style.display = 'block';
      } else {
        areaDisplay.style.display = 'none';
      }
      return;
    }

    // Red-line boundary mode
    if (!polygonFeature || !polygonComplete) {
      areaDisplay.style.display = 'none';
      return;
    }

    const geometry = polygonFeature.getGeometry();
    const areaSqMeters = geometry.getArea();
    const areaHectares = areaSqMeters / 10000;
    const areaInAcres = areaSqMeters / 4046.86;
    
    areaValue.textContent = areaHectares.toFixed(2);
    areaAcres.textContent = areaInAcres.toFixed(2);
    areaDisplay.style.display = 'block';
  }

  /**
   * Reset UI buttons to initial state
   */
  function resetDrawingButtons() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const clearButton = document.getElementById('clear-polygon');
    const saveButton = document.getElementById('save-boundary');
    
    if (startButton) startButton.style.display = 'inline-block';
    if (cancelButton) cancelButton.style.display = 'none';
    if (clearButton) clearButton.style.display = 'none';
    if (saveButton) saveButton.disabled = true;
  }

  /**
   * Cancel current drawing
   */
  function cancelDrawing() {
    if (!isDrawing) {
      return;
    }

    isDrawing = false;
    canClosePolygon = false;
    
    // Remove placed vertices
    placedVertices.forEach(v => {
      drawSource.removeFeature(v);
    });
    placedVertices = [];
    currentPolygonCoords = [];
    
    if (polygonFeature) {
      drawSource.removeFeature(polygonFeature);
      polygonFeature = null;
    }
    
    hoverSource.clear();

    if (dragPanInteraction && !dragPanInteraction.getActive()) {
      dragPanInteraction.setActive(true);
    }

    console.log('Drawing cancelled');
    
    if (currentMode === 'habitat-parcels') {
      updateUIForHabitatParcels();
    } else {
      resetDrawingButtons();
    }
  }

  /**
   * Clear the completed polygon (red-line-boundary mode)
   */
  function clearPolygon() {
    isDrawing = false;
    isEditing = false;
    polygonComplete = false;
    canClosePolygon = false;
    currentPolygonCoords = [];
    placedVertices = [];
    isDragging = false;
    draggedVertex = null;
    draggedVertexIndex = -1;
    
    drawSource.clear();
    hoverSource.clear();
    clearGhostVertex();
    
    polygonFeature = null;

    if (dragPanInteraction && !dragPanInteraction.getActive()) {
      dragPanInteraction.setActive(true);
    }

    const areaDisplay = document.getElementById('area-display');
    if (areaDisplay) {
      areaDisplay.style.display = 'none';
    }

    console.log('✓ Polygon cleared');
    
    resetDrawingButtons();
  }

  /**
   * Clear all habitat parcels
   */
  function clearAllParcels() {
    habitatParcels.forEach(parcel => {
      drawSource.removeFeature(parcel.feature);
      parcel.vertices.forEach(v => {
        drawSource.removeFeature(v);
      });
    });

    habitatParcels = [];
    currentParcelIndex = -1;
    
    console.log('✓ All parcels cleared');
    
    updateUIForHabitatParcels();
  }

  /**
   * Get current polygon coordinates
   * @returns {Array} Array of [x,y] coordinates in EPSG:3857
   */
  function getCurrentPolygonCoords() {
    return currentPolygonCoords;
  }

  /**
   * Check if polygon is complete
   * @returns {boolean}
   */
  function isPolygonComplete() {
    return polygonComplete;
  }

  /**
   * Get number of habitat parcels
   * @returns {number}
   */
  function getParcelCount() {
    return habitatParcels.length;
  }

  /**
   * Get current mode
   * @returns {string}
   */
  function getMode() {
    return currentMode;
  }

  /**
   * Enable or disable snapping to OS features
   */
  function setSnappingEnabled(enabled) {
    snappingEnabled = enabled;
    console.log(enabled ? '🧲 OS feature snapping enabled' : '🚫 OS feature snapping disabled');
  }

  /**
   * Check if OS feature snapping is currently enabled
   */
  function isSnappingEnabledFn() {
    return snappingEnabled;
  }

  /**
   * Enable or disable snapping to boundary
   */
  function setBoundarySnappingEnabled(enabled) {
    boundarySnappingEnabled = enabled;
    console.log(enabled ? '🧲 Boundary snapping enabled' : '🚫 Boundary snapping disabled');
  }

  /**
   * Check if boundary snapping is currently enabled
   */
  function isBoundarySnappingEnabled() {
    return boundarySnappingEnabled;
  }

  /**
   * Get information about the snap index
   */
  function getSnapIndexInfo() {
    const features = snapIndexSource.getFeatures();
    const layerTypes = {};
    
    features.forEach(f => {
      const type = f.get('layerType');
      layerTypes[type] = (layerTypes[type] || 0) + 1;
    });
    
    return {
      totalFeatures: features.length,
      byLayer: layerTypes,
      layers: SNAP_LAYERS,
      isFetching: isFetching,
      currentZoom: map.getView().getZoom(),
      minZoom: MIN_ZOOM_FOR_SNAP
    };
  }

  // Export public API
  window.SnapDrawing = {
    initSnapping: initSnapping,
    initWithConfig: initWithConfig,
    loadBoundary: loadBoundary,
    startDrawing: startDrawing,
    cancelDrawing: cancelDrawing,
    clearPolygon: clearPolygon,
    clearAllParcels: clearAllParcels,
    removeParcel: removeParcel,
    getDrawnPolygonGeoJSON: getDrawnPolygonGeoJSON,
    getHabitatParcelsGeoJSON: getHabitatParcelsGeoJSON,
    getCurrentPolygonCoords: getCurrentPolygonCoords,
    isPolygonComplete: isPolygonComplete,
    getParcelCount: getParcelCount,
    getMode: getMode,
    getSnapIndexInfo: getSnapIndexInfo,
    forceRefreshSnapData: fetchSnapData,
    setSnappingEnabled: setSnappingEnabled,
    isSnappingEnabled: isSnappingEnabledFn,
    setBoundarySnappingEnabled: setBoundarySnappingEnabled,
    isBoundarySnappingEnabled: isBoundarySnappingEnabled,
    validateAllParcels: validateAllParcels
  };

})(window);
