//
// Multi-layer snapping polygon drawing module for OS Open Zoomstack
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

  // Module state
  let map = null;
  let snapIndexSource = null;
  let snapIndexLayer = null;
  let drawLayer = null;
  let hoverLayer = null;
  let hoverSource = null;
  let drawSource = null;
  let dragPanInteraction = null;

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

  /**
   * Initialize the snapping system
   * @param {ol.Map} olMap - OpenLayers map instance
   */
  function initSnapping(olMap) {
    map = olMap;

    console.log('=== Snapping System Initializing ===');
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

    console.log('✓ Snapping system initialized successfully');
    console.log(`Min zoom for snapping: ${MIN_ZOOM_FOR_SNAP}`);
    console.log(`Current zoom: ${map.getView().getZoom()}`);
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
   * Style function for drawing layer features
   */
  function styleFunction(feature) {
    const type = feature.get('type');
    
    if (type === 'vertex') {
      const isFirst = feature.get('isFirst');
      const isHighlighted = feature.get('highlighted');
      const isHovered = feature.get('hovered');  // For edit mode hover
      const isBeingDragged = feature.get('dragging');
      
      let radius = 5;
      let fillColor = 'rgba(255, 100, 0, 0.8)';
      let strokeColor = 'white';
      let strokeWidth = 2;
      
      if (isBeingDragged) {
        // Being dragged
        radius = 8;
        fillColor = 'rgba(0, 150, 255, 0.9)';
        strokeColor = 'blue';
        strokeWidth = 3;
      } else if (isHighlighted) {
        // Ready to close polygon (first vertex during drawing)
        radius = 9;
        fillColor = 'rgba(255, 0, 0, 0.9)';
        strokeColor = 'rgba(200, 0, 0, 1)';
        strokeWidth = 3;
      } else if (isHovered && polygonComplete) {
        // Hovering in edit mode
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
    } else if (type === 'polygon') {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: 'rgba(220, 0, 0, 1)',  // Red stroke for "red-line boundary"
          width: 3
        }),
        fill: new ol.style.Fill({
          color: 'rgba(220, 0, 0, 0.15)'  // Red fill with low opacity
        })
      });
    } else if (type === 'ghost-vertex') {
      // Temporary vertex shown when hovering over polygon edge
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: 'rgba(255, 255, 255, 0.8)' }),
          stroke: new ol.style.Stroke({ 
            color: 'rgba(220, 0, 0, 1)',
            width: 2
          })
        }),
        zIndex: 150
      });
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

    // Click handler - place vertex or close polygon (use 'click' not 'singleclick' for immediate response)
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
    console.log('throttledFetchSnapData called');
    
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }

    fetchTimeout = setTimeout(() => {
      console.log('Throttle delay complete, calling fetchSnapData()');
      fetchSnapData();
    }, FETCH_THROTTLE_MS);
  }

  /**
   * Fetch WFS data for snapping
   */
  async function fetchSnapData() {
    const zoom = map.getView().getZoom();
    console.log(`[fetchSnapData] Current zoom: ${zoom}, Min zoom: ${MIN_ZOOM_FOR_SNAP}`);
    
    if (zoom < MIN_ZOOM_FOR_SNAP) {
      console.log(`⚠️  [fetchSnapData] Zoom too low (${zoom.toFixed(1)} < ${MIN_ZOOM_FOR_SNAP})`);
      console.log(`⚠️  Zoom in to level ${MIN_ZOOM_FOR_SNAP} or higher to enable snapping`);
      snapIndexSource.clear();
      return;
    }

    if (isFetching) {
      console.log('[fetchSnapData] Already fetching, skipping');
      return;
    }

    const extent = map.getView().calculateExtent(map.getSize());
    console.log('[fetchSnapData] Map extent (EPSG:3857):', extent);
    
    // Check if we've already fetched this area
    if (lastFetchExtent && ol.extent.equals(extent, lastFetchExtent)) {
      console.log('[fetchSnapData] Same extent as last fetch, skipping');
      return;
    }

    console.log('[fetchSnapData] Starting WFS fetch for', SNAP_LAYERS.length, 'layers');
    lastFetchExtent = extent;
    isFetching = true;

    try {
      // Clear existing snap data
      snapIndexSource.clear();

      // Fetch all layers in parallel
      const fetchPromises = SNAP_LAYERS.map(typeName => 
        fetchLayerData(typeName, extent)
      );

      const results = await Promise.allSettled(fetchPromises);
      
      // Process results
      const allFeatures = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allFeatures.push(...result.value);
        } else if (result.status === 'rejected') {
          console.warn(`Failed to fetch ${SNAP_LAYERS[index]}:`, result.reason);
        }
      });

      // Add features to snap index
      if (allFeatures.length > 0) {
        snapIndexSource.addFeatures(allFeatures);
        console.log(`✅ Loaded ${allFeatures.length} snap features - snapping is now active!`);
        console.log('💡 Double-click anywhere to start drawing');
      } else {
        console.warn('⚠️  No snap features loaded. Try zooming into a different area or check API key permissions.');
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

    // Convert extent from EPSG:3857 to EPSG:27700 (British National Grid)
    // OS Features API works best with EPSG:27700
    let minCoord, maxCoord, bbox;
    
    try {
      minCoord = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:27700');
      maxCoord = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:27700');
      
      // bbox format for WFS: minX,minY,maxX,maxY in the specified CRS
      bbox = `${minCoord[0]},${minCoord[1]},${maxCoord[0]},${maxCoord[1]}`;
    } catch (error) {
      console.error(`❌ Failed to transform coordinates for ${typeName}:`, error);
      console.error('Make sure EPSG:27700 projection is properly registered');
      return [];
    }

    while (hasMore && startIndex < 1000) { // Safety limit
      const url = `${WFS_ENDPOINT}?` +
        `typeNames=${typeName}` +
        `&srsName=EPSG:27700` +
        `&outputFormat=GEOJSON` +
        `&bbox=${bbox},EPSG:27700` +
        `&count=${MAX_FEATURES_PER_REQUEST}` +
        `&startIndex=${startIndex}`;

      // Debug logging
      if (startIndex === 0) {
        console.log(`Fetching ${typeName}:`, url);
      }

      try {
        const response = await fetch(url);
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`HTTP ${response.status} for ${typeName}:`, errorText);
          throw new Error(`HTTP ${response.status}`);
        }

        const geojson = await response.json();
        
        // Debug logging
        if (startIndex === 0) {
          console.log(`${typeName} returned ${geojson.features?.length || 0} features`);
        }
        
        if (geojson.features && geojson.features.length > 0) {
          try {
            // Parse with OpenLayers GeoJSON format
            // Data comes in EPSG:27700, convert to EPSG:3857 for the map
            const format = new ol.format.GeoJSON();
            const olFeatures = format.readFeatures(geojson, {
              dataProjection: 'EPSG:27700',
              featureProjection: 'EPSG:3857'
            });

            // Process and simplify geometries
            olFeatures.forEach(feature => {
              const geom = feature.getGeometry();
              if (geom) {
                // Simplify for better performance
                const simplified = geom.simplify(SIMPLIFY_TOLERANCE);
                feature.setGeometry(simplified);
                feature.set('layerType', typeName);
              }
            });

            features.push(...olFeatures);
          } catch (transformError) {
            console.error(`❌ Failed to transform features for ${typeName}:`, transformError);
            console.error('EPSG:27700 projection may not be properly registered');
            hasMore = false;
            break;
          }

          // Check if there are more features
          if (geojson.features.length < MAX_FEATURES_PER_REQUEST) {
            hasMore = false;
          } else {
            startIndex += MAX_FEATURES_PER_REQUEST;
          }
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error(`Error fetching ${typeName} at startIndex ${startIndex}:`, error);
        hasMore = false;
      }
    }

    if (features.length > 0) {
      console.log(`✓ Successfully loaded ${features.length} features from ${typeName}`);
    } else {
      console.warn(`✗ No features loaded from ${typeName}`);
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

    // Handle dragging a vertex
    if (isDragging && draggedVertex) {
      updateDraggedVertex(snapCoord);
      return;
    }

    // Check if we actually snapped (coordinate changed)
    const didSnap = coordinate[0] !== snapCoord[0] || coordinate[1] !== snapCoord[1];

    // Update hover marker with snap state (only during drawing)
    if (isDrawing) {
      updateHoverMarker(snapCoord, didSnap);
    }

    // Update live polygon if drawing
    if (isDrawing && currentPolygonCoords.length > 0) {
      updateLivePolygon(snapCoord);
    }

    // Check if hovering over first vertex (during drawing)
    if (isDrawing && currentPolygonCoords.length >= 3) {
      checkFirstVertexHover(evt.pixel);
    }

    // Check if hovering over any vertex (in edit mode)
    if (polygonComplete && !isDrawing) {
      checkVertexHover(evt.pixel);
      
      // Check if hovering over polygon edge (not over a vertex)
      if (!isOverVertex(evt.pixel)) {
        checkPolygonEdgeHover(evt.pixel, snapCoord);
      } else {
        // Clear ghost vertex if hovering over a real vertex
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
      cursor = 'copy';  // Indicate new point can be added
    }
    map.getTargetElement().style.cursor = cursor;
  }

  /**
   * Find the nearest snap point
   */
  function findSnapPoint(coordinate) {
    // If snapping is disabled, return coordinate as-is
    if (!snappingEnabled) {
      return coordinate;
    }

    const features = snapIndexSource.getFeatures();
    
    if (features.length === 0) {
      return coordinate;
    }

    let minDistance = Infinity;
    let snapPoint = null;
    let snappedToFeature = false;

    const pixelTolerance = SNAP_TOLERANCE_PX;
    const resolution = map.getView().getResolution();
    const tolerance = pixelTolerance * resolution;

    // First pass: check all feature edges
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
          snappedToFeature = true;
        }
      } else if (type === 'MultiLineString') {
        geom.getLineStrings().forEach(line => {
          const pt = line.getClosestPoint(coordinate);
          const dist = getDistance(coordinate, pt);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            snapPoint = pt;
            snappedToFeature = true;
          }
        });
      } else if (type === 'Polygon') {
        // Snap to outer ring
        const ring = geom.getLinearRing(0);
        const pt = ring.getClosestPoint(coordinate);
        const dist = getDistance(coordinate, pt);
        if (dist < minDistance && dist < tolerance) {
          minDistance = dist;
          snapPoint = pt;
          snappedToFeature = true;
        }
      } else if (type === 'MultiPolygon') {
        geom.getPolygons().forEach(poly => {
          const ring = poly.getLinearRing(0);
          const pt = ring.getClosestPoint(coordinate);
          const dist = getDistance(coordinate, pt);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            snapPoint = pt;
            snappedToFeature = true;
          }
        });
      }
    });

    // Second pass: check vertices (higher priority - smaller tolerance)
    const vertexTolerance = tolerance * 0.5; // Prefer vertices
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
          snappedToFeature = true;
        }
      });
    });

    // If snapped, log it for debugging (only occasionally to avoid spam)
    if (snappedToFeature && Math.random() < 0.05) {
      console.log(`🎯 Snapped! Distance: ${minDistance.toFixed(2)}m, Tolerance: ${tolerance.toFixed(2)}m`);
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
    // Build temporary coordinates including hover position
    const tempCoords = [...currentPolygonCoords, snapCoord];
    
    if (tempCoords.length >= 2) {
      // Remove old polygon feature
      if (polygonFeature) {
        drawSource.removeFeature(polygonFeature);
      }

      // Create new polygon feature
      let geom;
      if (tempCoords.length === 2) {
        // Show as line if only 2 points
        geom = new ol.geom.LineString(tempCoords);
      } else {
        // Show as polygon
        geom = new ol.geom.Polygon([tempCoords]);
      }

      polygonFeature = new ol.Feature({
        geometry: geom,
        type: 'polygon'
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

    if (polygonComplete) {
      console.warn('⚠️  A polygon already exists. Clear it first before drawing a new one.');
      return;
    }

    // Start drawing mode
    isDrawing = true;
    currentPolygonCoords = [];
    placedVertices = [];
    canClosePolygon = false;

    console.log('✏️  Drawing mode started - hover cursor will now appear');
    console.log('💡 Click to place first vertex (will snap to features)');
  }

  /**
   * Handle click to place vertex or close polygon
   */
  function handleSingleClick(evt) {
    // Don't handle click during/after drag or if not drawing
    if (isDragging || justFinishedDragging || !isDrawing) {
      return;
    }

    // Check if clicking to close
    if (canClosePolygon && currentPolygonCoords.length >= 3) {
      closePolygon();
      return;
    }

    // Place new vertex (first vertex if none placed yet)
    const snapCoord = lastSnapCoord || evt.coordinate;
    const isFirstVertex = currentPolygonCoords.length === 0;
    placeVertex(snapCoord, isFirstVertex);
    
    if (isFirstVertex) {
      console.log('✓ First vertex placed (snapped)');
    }
  }

  /**
   * Place a vertex at the given coordinate
   */
  function placeVertex(coordinate, isFirst) {
    currentPolygonCoords.push([...coordinate]);

    // Create vertex marker
    const vertexFeature = new ol.Feature({
      geometry: new ol.geom.Point(coordinate),
      type: 'vertex',
      isFirst: isFirst,
      highlighted: false
    });

    placedVertices.push(vertexFeature);
    drawSource.addFeature(vertexFeature);

    console.log(`Vertex placed (${currentPolygonCoords.length}):`, coordinate);
  }

  /**
   * Close the polygon and finish drawing
   */
  function closePolygon() {
    if (currentPolygonCoords.length < 3) {
      return;
    }

    // Close the ring by adding first coordinate at the end
    const firstCoord = currentPolygonCoords[0];
    currentPolygonCoords.push([...firstCoord]);

    // Update polygon feature with closed ring
    if (polygonFeature) {
      drawSource.removeFeature(polygonFeature);
    }

    polygonFeature = new ol.Feature({
      geometry: new ol.geom.Polygon([currentPolygonCoords]),
      type: 'polygon'
    });
    drawSource.addFeature(polygonFeature);

    // Clear hover marker
    hoverSource.clear();

    // Reset first vertex highlight
    if (placedVertices.length > 0) {
      placedVertices[0].set('highlighted', false);
      placedVertices[0].changed();
    }

    isDrawing = false;
    canClosePolygon = false;
    polygonComplete = true;
    isEditing = true;

    console.log('✅ Polygon closed:', currentPolygonCoords.length - 1, 'vertices');
    console.log('💡 You can now edit the polygon by dragging vertices');
    
    // Update UI buttons to show Clear Polygon
    updateUIForCompletePolygon();
    
    // Calculate and display area
    updateAreaDisplay();
  }

  /**
   * Get the drawn polygon as GeoJSON
   * @returns {Object|null} GeoJSON Polygon in EPSG:3857
   */
  function getDrawnPolygonGeoJSON() {
    if (currentPolygonCoords.length < 4) {
      return null;
    }

    // Ensure ring is closed
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
   * Handle pointer down - start dragging vertex or insert new vertex
   */
  function handlePointerDown(evt) {
    if (!polygonComplete || isDrawing) {
      return;
    }

    // Check if clicking on ghost vertex (to insert new vertex)
    if (ghostVertex && ghostVertexCoord && ghostVertexInsertIndex >= 0) {
      insertNewVertex(ghostVertexCoord, ghostVertexInsertIndex);
      clearGhostVertex();
      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    // Check if clicking on a vertex
    const feature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    if (feature) {
      // Start dragging this vertex
      draggedVertex = feature;
      draggedVertexIndex = placedVertices.indexOf(feature);
      isDragging = true;
      
      feature.set('dragging', true);
      feature.changed();
      
      console.log(`🎯 Dragging vertex ${draggedVertexIndex}`);
      
      // Disable map panning to allow vertex dragging
      if (dragPanInteraction) {
        dragPanInteraction.setActive(false);
        console.log('🔒 Map panning disabled for vertex editing');
      }
      
      // Stop the event from propagating to map interactions
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

    // Finish dragging
    draggedVertex.set('dragging', false);
    draggedVertex.changed();
    
    console.log(`✓ Vertex ${draggedVertexIndex} moved to new position`);
    
    // Re-enable map panning
    if (dragPanInteraction) {
      dragPanInteraction.setActive(true);
      console.log('🔓 Map panning re-enabled');
    }
    
    isDragging = false;
    draggedVertex = null;
    draggedVertexIndex = -1;
    
    // Set flag to prevent immediate click after drag
    justFinishedDragging = true;
    setTimeout(() => {
      justFinishedDragging = false;
    }, 50);  // 50ms delay
  }

  /**
   * Update the position of the dragged vertex
   */
  function updateDraggedVertex(snapCoord) {
    if (!draggedVertex || draggedVertexIndex < 0) {
      return;
    }

    // Update the vertex feature position
    draggedVertex.getGeometry().setCoordinates(snapCoord);

    // Update the coordinate in the array
    currentPolygonCoords[draggedVertexIndex] = [...snapCoord];
    
    // If it's the first vertex, also update the closing coordinate
    if (draggedVertexIndex === 0) {
      currentPolygonCoords[currentPolygonCoords.length - 1] = [...snapCoord];
    }
    // If it's the last coordinate (closing point), update first vertex
    else if (draggedVertexIndex === currentPolygonCoords.length - 1) {
      currentPolygonCoords[0] = [...snapCoord];
      placedVertices[0].getGeometry().setCoordinates(snapCoord);
    }

    // Update the polygon geometry
    if (polygonFeature) {
      polygonFeature.getGeometry().setCoordinates([currentPolygonCoords]);
    }
    
    // Update area display
    updateAreaDisplay();
  }

  /**
   * Check if hovering over any vertex in edit mode
   */
  function checkVertexHover(pixel) {
    // Clear all hover states first
    placedVertices.forEach(v => {
      if (v.get('hovered')) {
        v.set('hovered', false);
        v.changed();
      }
    });

    // Check if hovering over a vertex
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

    // Check if hovering over the polygon
    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      if (feature.get('type') === 'polygon') {
        return feature;
      }
    }, {
      layerFilter: (layer) => layer === drawLayer,
      hitTolerance: 5
    });

    if (feature) {
      // Find closest point on polygon edge
      const geometry = feature.getGeometry();
      const ring = geometry.getCoordinates()[0];
      
      let minDistance = Infinity;
      let closestPoint = null;
      let insertIndex = -1;

      // Check each edge segment
      for (let i = 0; i < ring.length - 1; i++) {
        const start = ring[i];
        const end = ring[i + 1];
        
        // Create line segment
        const line = new ol.geom.LineString([start, end]);
        const closestOnSegment = line.getClosestPoint(snapCoord);
        const distance = getDistance(snapCoord, closestOnSegment);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = closestOnSegment;
          insertIndex = i + 1;  // Insert after this vertex
        }
      }

      // Show ghost vertex if close enough to edge
      if (closestPoint && minDistance < 50) {  // 50 map units tolerance
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

    // Insert coordinate into array
    currentPolygonCoords.splice(insertIndex, 0, [...coordinate]);

    // Create new vertex feature
    const newVertexFeature = new ol.Feature({
      geometry: new ol.geom.Point(coordinate),
      type: 'vertex',
      isFirst: false,
      highlighted: false,
      hovered: false
    });

    // Insert into placedVertices array
    placedVertices.splice(insertIndex, 0, newVertexFeature);
    drawSource.addFeature(newVertexFeature);

    // Update first vertex flag (only first one should have it)
    placedVertices.forEach((v, idx) => {
      v.set('isFirst', idx === 0);
    });

    // Update the closing coordinate to match first vertex
    currentPolygonCoords[currentPolygonCoords.length - 1] = [...currentPolygonCoords[0]];

    // Update the polygon geometry
    if (polygonFeature) {
      polygonFeature.getGeometry().setCoordinates([currentPolygonCoords]);
    }

    // Update area display
    updateAreaDisplay();

    console.log(`✓ New vertex added. Total vertices: ${placedVertices.length}`);
  }

  /**
   * Update UI buttons when polygon is complete
   */
  function updateUIForCompletePolygon() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const clearButton = document.getElementById('clear-polygon');
    
    if (startButton && cancelButton && clearButton) {
      startButton.style.display = 'none';
      cancelButton.style.display = 'none';
      clearButton.style.display = 'inline-block';
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

    if (!polygonFeature || !polygonComplete) {
      areaDisplay.style.display = 'none';
      return;
    }

    // Calculate area in square meters
    const geometry = polygonFeature.getGeometry();
    const areaSqMeters = geometry.getArea();
    
    // Convert to hectares (1 hectare = 10,000 square meters)
    const areaHectares = areaSqMeters / 10000;
    
    // Convert to acres (1 acre = 4046.86 square meters)
    const areaInAcres = areaSqMeters / 4046.86;
    
    // Display values
    areaValue.textContent = areaHectares.toFixed(2);
    areaAcres.textContent = areaInAcres.toFixed(2);
    areaDisplay.style.display = 'block';
    
    console.log(`📏 Area: ${areaHectares.toFixed(2)} ha (${areaInAcres.toFixed(2)} acres)`);
  }

  /**
   * Reset UI buttons to initial state
   */
  function resetDrawingButtons() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const clearButton = document.getElementById('clear-polygon');
    
    if (startButton && cancelButton && clearButton) {
      startButton.style.display = 'inline-block';
      cancelButton.style.display = 'none';
      clearButton.style.display = 'none';
    }
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
    currentPolygonCoords = [];
    placedVertices = [];
    
    drawSource.clear();
    hoverSource.clear();
    
    if (polygonFeature) {
      polygonFeature = null;
    }

    // Ensure map panning is re-enabled
    if (dragPanInteraction && !dragPanInteraction.getActive()) {
      dragPanInteraction.setActive(true);
    }

    console.log('Drawing cancelled');
    
    // Reset UI buttons
    resetDrawingButtons();
  }

  /**
   * Clear the completed polygon
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
    
    if (polygonFeature) {
      polygonFeature = null;
    }

    // Ensure map panning is re-enabled
    if (dragPanInteraction && !dragPanInteraction.getActive()) {
      dragPanInteraction.setActive(true);
    }

    // Hide area display
    const areaDisplay = document.getElementById('area-display');
    if (areaDisplay) {
      areaDisplay.style.display = 'none';
    }

    console.log('✓ Polygon cleared - ready to draw a new one');
    
    // Reset UI buttons to show Start Drawing
    resetDrawingButtons();
  }

  /**
   * Get current polygon coordinates
   * @returns {Array} Array of [x,y] coordinates in EPSG:3857
   */
  function getCurrentPolygonCoords() {
    return currentPolygonCoords;
  }

  /**
   * Test the WFS API with a simple request
   * @param {string} testTypeName - Optional layer name to test
   */
  async function testWFSConnection(testTypeName = null) {
    const typeName = testTypeName || SNAP_LAYERS[0];
    const extent = map.getView().calculateExtent(map.getSize());
    
    console.log('=== WFS API Test ===');
    console.log('Testing layer:', typeName);
    console.log('Current zoom:', map.getView().getZoom());
    console.log('Current extent (EPSG:3857):', extent);
    
    // Convert to EPSG:27700
    const minCoord = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:27700');
    const maxCoord = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:27700');
    const bbox = `${minCoord[0]},${minCoord[1]},${maxCoord[0]},${maxCoord[1]}`;
    
    console.log('Extent (EPSG:27700):', bbox);
    
    const url = `${WFS_ENDPOINT}?` +
      `typeNames=${typeName}` +
      `&srsName=EPSG:27700` +
      `&outputFormat=GEOJSON` +
      `&bbox=${bbox},EPSG:27700` +
      `&count=10`;
    
    console.log('Test URL:', url);
    
    try {
      const response = await fetch(url);
      console.log('Response status:', response.status);
      
      const data = await response.json();
      console.log('Response data:', data);
      console.log('Features returned:', data.features?.length || 0);
      
      if (data.features && data.features.length > 0) {
        console.log('✓ API is working! First feature:', data.features[0]);
      } else {
        console.warn('✗ API returned no features. Try:');
        console.warn('  1. Zoom to a different area (try London)');
        console.warn('  2. Check if this layer type exists');
        console.warn('  3. Try a different layer name');
      }
      
      return data;
    } catch (error) {
      console.error('✗ API test failed:', error);
      return null;
    }
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

  /**
   * Enable or disable snapping to features
   */
  function setSnappingEnabled(enabled) {
    snappingEnabled = enabled;
    console.log(enabled ? '🧲 Snapping enabled' : '🚫 Snapping disabled');
  }

  /**
   * Check if snapping is currently enabled
   */
  function isSnappingEnabled() {
    return snappingEnabled;
  }

  // Export public API
  window.SnapDrawing = {
    initSnapping: initSnapping,
    startDrawing: startDrawing,
    cancelDrawing: cancelDrawing,
    clearPolygon: clearPolygon,
    getDrawnPolygonGeoJSON: getDrawnPolygonGeoJSON,
    getCurrentPolygonCoords: getCurrentPolygonCoords,
    testWFSConnection: testWFSConnection,
    getSnapIndexInfo: getSnapIndexInfo,
    forceRefreshSnapData: fetchSnapData,
    setSnappingEnabled: setSnappingEnabled,
    isSnappingEnabled: isSnappingEnabled
  };

})(window);

