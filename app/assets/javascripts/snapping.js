//
// Multi-layer snapping polygon drawing module for OS NGD
// Supports two modes: 'red-line-boundary' (single polygon) and 'habitat-parcels' (multiple polygons)
//

(function(window) {
  'use strict';

  // OS NGD feature collections - Buildings, Roads, Rail, and Watercourses
  const SNAP_LAYERS = [
    // Buildings + Structures
    'bld-fts-building-1',            // Building footprints  
    'bld-fts-building-2',            // Building secondary/detail  
    'bld-fts-building-3',            // Building attributes/detail  
    'bld-fts-buildingline-1',        // Building boundary lines
    'str-fts-fieldboundary-1',       // Field boundaries (walls, fences etc)
    'str-fts-structureline-1',       // Other linear structures
  
    // Land & Site areas
    'lnd-fts-land-1',                // Land areas (fields/areas)
    'lnd-fts-land-2',                // Land type variants
    'lnd-fts-land-3',                // Additional land area types
    'lus-fts-site-1',                // Site extents (land use areas)
    'lus-fts-site-2',                // Additional site extents
  
    // Water Network – centrelines & nodes
    'wtr-ntwk-waterlink-1',          // Watercourse links (rivers/streams)
    'wtr-ntwk-waterlink-2',          // Additional watercourse links
    'wtr-ntwk-waternode-1',          // Nodes/intersections of water network
  
    // Waterbody polygons
    'wtr-fts-water-1',               // Water area polygons  
    'wtr-fts-water-2',               // Additional water area types
    'wtr-fts-water-3',               // Extra water area detail
  
    // Vegetation / Hedgerows
    'lnd-fts-landformline-1',        // Natural linear landforms
    'lnd-fts-landformpoint-1',       // Natural point landforms
    'lnd-fts-landpoint-1',           // Land point features
    // Note: OS NGD does not have a dedicated “hedgerow” type – use linear vegetation from landform or fieldboundary context
  
    // Transport Network – roads/paths/rail
    'trn-ntwk-roadlink-1',           // Road network link 1
    'trn-ntwk-roadlink-2',           // Road network link 2
    'trn-ntwk-roadlink-3',           // Road network link 3
    'trn-ntwk-roadlink-4',           // Road network link 4
    'trn-ntwk-roadlink-5',           // Road network link 5
    'trn-ntwk-road-1',               // Road centreline
    'trn-ntwk-pathlink-1',           // Path network link 1
    'trn-ntwk-pathlink-2',           // Path network link 2
    'trn-ntwk-pathlink-3',           // Path network link 3
    'trn-ntwk-path-1',               // Path network
    'trn-ntwk-railwaylink-1',        // Railway centreline
    'trn-ntwk-railwaylinkset-1',     // Railway link sets
  ];

  // Use the backend proxy endpoint for OS Features API
  const WFS_ENDPOINT = '/api/os/features';
  const MIN_ZOOM_FOR_SNAP = 14;  // Only fetch at detailed zoom levels
  const FETCH_THROTTLE_MS = 300;
  const SNAP_TOLERANCE_PX = 25;  // Increased for better snapping UX
  const CLOSE_TOLERANCE_PX = 10;
  const SIMPLIFY_TOLERANCE = 0.25;
  const MAX_FEATURES_PER_REQUEST = 100;

  // Snap type tracking for visual feedback
  const SNAP_TYPE = {
    NONE: 'none',
    OS_FEATURE: 'os-feature',
    BOUNDARY_VERTEX: 'boundary-vertex',
    BOUNDARY_EDGE: 'boundary-edge',
    PARCEL_VERTEX: 'parcel-vertex',
    PARCEL_EDGE: 'parcel-edge'
  };

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
  let boundaryVerticesLayer = null;
  let boundaryVerticesSource = null;
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
  let lastSnapType = SNAP_TYPE.NONE;
  let canClosePolygon = false;
  let snappingEnabled = true;
  
  // Fine-grained snapping controls
  let snapToBoundaryVertices = true;
  let snapToBoundaryEdges = true;
  let snapToParcelVertices = true;
  let snapToParcelEdges = true;

  // Habitat parcels mode - multiple polygons
  let habitatParcels = [];  // Array of { feature, coords, vertices, colorIndex }
  let currentParcelIndex = -1;  // Index of parcel being drawn, -1 if not drawing
  let editingParcelIndex = -1;  // Index of parcel being edited, -1 if not editing

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

    // Boundary vertices layer (shows vertices as permanent markers for reference)
    boundaryVerticesSource = new ol.source.Vector();
    boundaryVerticesLayer = new ol.layer.Vector({
      source: boundaryVerticesSource,
      style: new ol.style.Style({
        image: new ol.style.Circle({
          radius: 6,
          fill: new ol.style.Fill({ color: 'rgba(212, 53, 28, 0.8)' }),  // Red to match boundary
          stroke: new ol.style.Stroke({ 
            color: 'white', 
            width: 2 
          })
        }),
        zIndex: 200
      }),
      zIndex: 15
    });
    map.addLayer(boundaryVerticesLayer);

    // Hover marker layer (with dynamic styling based on snap type)
    hoverSource = new ol.source.Vector();
    hoverLayer = new ol.layer.Vector({
      source: hoverSource,
      style: function(feature) {
        const snapType = feature.get('snapType') || SNAP_TYPE.NONE;
        
        let radius = 6;
        let fillColor = 'rgba(0, 150, 255, 0.6)';  // Blue for no snap
        let strokeWidth = 2;
        
        // Apply distinct styling based on snap type
        if (snapType === SNAP_TYPE.BOUNDARY_VERTEX) {
          radius = 10;
          fillColor = 'rgba(212, 53, 28, 0.8)';  // Red for boundary vertex
          strokeWidth = 3;
        } else if (snapType === SNAP_TYPE.PARCEL_VERTEX) {
          radius = 10;
          fillColor = 'rgba(174, 37, 115, 0.8)';  // Magenta for parcel vertex
          strokeWidth = 3;
        } else if (snapType === SNAP_TYPE.BOUNDARY_EDGE) {
          radius = 8;
          fillColor = 'rgba(255, 140, 0, 0.8)';  // Orange for boundary edge
          strokeWidth = 2;
        } else if (snapType === SNAP_TYPE.PARCEL_EDGE) {
          radius = 8;
          fillColor = 'rgba(255, 140, 0, 0.8)';  // Orange for parcel edge
          strokeWidth = 2;
        } else if (snapType === SNAP_TYPE.OS_FEATURE) {
          radius = 8;
          fillColor = 'rgba(255, 165, 0, 0.8)';  // Orange for OS feature
          strokeWidth = 2;
        }
        
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: radius,
            fill: new ol.style.Fill({ color: fillColor }),
            stroke: new ol.style.Stroke({ 
              color: 'white', 
              width: strokeWidth 
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
      
      // In habitat-parcels mode, only show vertices for the parcel being edited or during drawing
      if (currentMode === 'habitat-parcels') {
        // Check if this vertex belongs to a completed parcel
        let belongsToCompletedParcel = false;
        let belongsToEditingParcel = false;
        
        for (let i = 0; i < habitatParcels.length; i++) {
          if (habitatParcels[i].vertices.includes(feature)) {
            belongsToCompletedParcel = true;
            if (i === editingParcelIndex) {
              belongsToEditingParcel = true;
            }
            break;
          }
        }
        
        // Hide vertices of completed parcels that aren't being edited
        if (belongsToCompletedParcel && !belongsToEditingParcel) {
          return null;  // Hide this vertex
        }
      }
      
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
      } else if (isHovered && (polygonComplete || editingParcelIndex >= 0)) {
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

      // Add boundary vertices as permanent visible markers
      boundaryVerticesSource.clear();
      const boundaryCoords = boundaryPolygon.getCoordinates()[0];
      boundaryCoords.forEach((coord, index) => {
        // Skip the last coordinate (it's a duplicate of the first for closing the ring)
        if (index < boundaryCoords.length - 1) {
          const vertexFeature = new ol.Feature({
            geometry: new ol.geom.Point(coord),
            type: 'boundary-vertex-marker'
          });
          boundaryVerticesSource.addFeature(vertexFeature);
        }
      });

      // Zoom to boundary extent with padding
      const extent = boundaryPolygon.getExtent();
      map.getView().fit(extent, {
        padding: [50, 50, 50, 50],
        duration: 500,
        maxZoom: 16
      });

      // Update boundary area display
      updateBoundaryAreaDisplay();
      updateTotalArea();

      console.log('✓ Boundary loaded and map zoomed to fit');
      console.log(`✓ ${boundaryCoords.length - 1} boundary vertices displayed`);
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
  async function fetchLayerData(collectionId, extent) {
    const features = [];
    let offset = 0;
    let hasMore = true;

    let minCoord, maxCoord, bbox;
    
    try {
      minCoord = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:27700');
      maxCoord = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:27700');
      bbox = `${minCoord[0]},${minCoord[1]},${maxCoord[0]},${maxCoord[1]}`;
    } catch (error) {
      console.error(`❌ Failed to transform coordinates for ${collectionId}:`, error);
      return [];
    }

    while (hasMore && offset < 1000) {
      const url = `${WFS_ENDPOINT}/${collectionId}/items?` +
        `bbox=${bbox}` +
        `&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/27700` +
        `&crs=http://www.opengis.net/def/crs/EPSG/0/27700` +
        `&limit=${MAX_FEATURES_PER_REQUEST}` +
        `&offset=${offset}`;

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
              feature.set('layerType', collectionId);
            }
          });

          features.push(...olFeatures);

          if (geojson.features.length < MAX_FEATURES_PER_REQUEST) {
            hasMore = false;
          } else {
            offset += MAX_FEATURES_PER_REQUEST;
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
    const snapResult = findSnapPoint(coordinate);
    let snapCoord = snapResult.coordinate;
    let snapType = snapResult.snapType;
    
    // Clamp to boundary if any boundary snapping is enabled in habitat-parcels mode
    if ((snapToBoundaryVertices || snapToBoundaryEdges) && currentMode === 'habitat-parcels' && boundaryPolygon) {
      snapCoord = clampToBoundary(snapCoord);
      // If clamped, update snap type if it changed the coordinate
      if (snapCoord[0] !== snapResult.coordinate[0] || snapCoord[1] !== snapResult.coordinate[1]) {
        snapType = SNAP_TYPE.BOUNDARY_EDGE;
      }
    }
    
    lastSnapCoord = snapCoord;
    lastSnapType = snapType;

    if (isDragging && draggedVertex) {
      updateDraggedVertex(snapCoord);
      return;
    }

    if (isDrawing) {
      updateHoverMarker(snapCoord, snapType);
    }

    if (isDrawing && currentPolygonCoords.length > 0) {
      updateLivePolygon(snapCoord);
    }

    if (isDrawing && currentPolygonCoords.length >= 3) {
      checkFirstVertexHover(evt.pixel);
    }

    // Handle editing mode (both red-line boundary and habitat parcels)
    const canEdit = (polygonComplete && !isDrawing) || (editingParcelIndex >= 0);
    
    if (canEdit) {
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
    } else if (canEdit && isOverVertex(evt.pixel)) {
      cursor = 'grab';
    } else if (canEdit && ghostVertex) {
      cursor = 'copy';
    }
    map.getTargetElement().style.cursor = cursor;
  }

  /**
   * Find the nearest snap point
   * Checks OS features (if enabled), boundary (if enabled), and existing parcels (always in habitat-parcels mode)
   * @returns {Object} { coordinate: [x, y], snapType: SNAP_TYPE.* }
   */
  function findSnapPoint(coordinate) {
    let minDistance = Infinity;
    let snapPoint = null;
    let snapType = SNAP_TYPE.NONE;

    const pixelTolerance = SNAP_TOLERANCE_PX;
    const resolution = map.getView().getResolution();
    const tolerance = pixelTolerance * resolution;
    const vertexTolerance = tolerance * 1.5;  // Even looser tolerance for vertices - highest priority for precise snapping

    // ========================================
    // PRIORITY GROUP 1: BOUNDARY & PARCEL SNAPPING (Always wins over OS features)
    // ========================================

    // 1A: Check boundary vertices FIRST (highest priority in habitat-parcels mode)
    if (snapToBoundaryVertices && currentMode === 'habitat-parcels' && boundaryPolygon) {
      const boundaryCoords = boundaryPolygon.getCoordinates()[0];
      boundaryCoords.forEach(vertex => {
        const distance = getDistance(coordinate, vertex);
        if (distance < minDistance && distance < vertexTolerance) {
          minDistance = distance;
          snapPoint = vertex;
          snapType = SNAP_TYPE.BOUNDARY_VERTEX;
        }
      });
    }

    // 1B: Check parcel vertices (habitat-parcels mode)
    if (snapToParcelVertices && currentMode === 'habitat-parcels' && habitatParcels.length > 0) {
      habitatParcels.forEach((parcel, index) => {
        // Skip the parcel being edited (don't snap to self during editing)
        // But allow snapping to completed parcels when drawing a new one
        if (index === editingParcelIndex) {
          return;
        }
        // Skip the parcel currently being drawn (not yet completed)
        if (isDrawing && index === currentParcelIndex) {
          return;
        }

        const parcelGeom = parcel.feature.getGeometry();
        if (!parcelGeom) return;

        // Snap to parcel vertices
        const parcelCoords = parcelGeom.getCoordinates()[0];
        parcelCoords.forEach(vertex => {
          const distance = getDistance(coordinate, vertex);
          if (distance < minDistance && distance < vertexTolerance) {
            minDistance = distance;
            snapPoint = vertex;
            snapType = SNAP_TYPE.PARCEL_VERTEX;
          }
        });
      });
    }

    // 1C: Check boundary edges (habitat-parcels mode)
    if (snapToBoundaryEdges && currentMode === 'habitat-parcels' && boundaryPolygon) {
      const ring = boundaryPolygon.getLinearRing(0);
      const pt = ring.getClosestPoint(coordinate);
      const dist = getDistance(coordinate, pt);
      if (dist < minDistance && dist < tolerance) {
        minDistance = dist;
        snapPoint = pt;
        snapType = SNAP_TYPE.BOUNDARY_EDGE;
      }
    }

    // 1D: Check parcel edges (habitat-parcels mode)
    if (snapToParcelEdges && currentMode === 'habitat-parcels' && habitatParcels.length > 0) {
      habitatParcels.forEach((parcel, index) => {
        // Skip the parcel being edited (don't snap to self during editing)
        // But allow snapping to completed parcels when drawing a new one
        if (index === editingParcelIndex) {
          return;
        }
        // Skip the parcel currently being drawn (not yet completed)
        if (isDrawing && index === currentParcelIndex) {
          return;
        }

        const parcelGeom = parcel.feature.getGeometry();
        if (!parcelGeom) return;

        // Snap to parcel edges
        const ring = parcelGeom.getLinearRing(0);
        const pt = ring.getClosestPoint(coordinate);
        const dist = getDistance(coordinate, pt);
        if (dist < minDistance && dist < tolerance) {
          minDistance = dist;
          snapPoint = pt;
          snapType = SNAP_TYPE.PARCEL_EDGE;
        }
      });
    }

    // ========================================
    // PRIORITY GROUP 2: OS FEATURES (Lower priority)
    // ========================================

    // 2A: Check OS features (if snapping enabled)
    // Check vertices first for higher priority, then edges
    if (snappingEnabled) {
      const features = snapIndexSource.getFeatures();
      
      // Check OS feature vertices FIRST (highest priority)
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
            snapType = SNAP_TYPE.OS_FEATURE;
          }
        });
      });

      // Then check feature edges
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
            snapType = SNAP_TYPE.OS_FEATURE;
          }
        } else if (type === 'MultiLineString') {
          geom.getLineStrings().forEach(line => {
            const pt = line.getClosestPoint(coordinate);
            const dist = getDistance(coordinate, pt);
            if (dist < minDistance && dist < tolerance) {
              minDistance = dist;
              snapPoint = pt;
              snapType = SNAP_TYPE.OS_FEATURE;
            }
          });
        } else if (type === 'Polygon') {
          const ring = geom.getLinearRing(0);
          const pt = ring.getClosestPoint(coordinate);
          const dist = getDistance(coordinate, pt);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            snapPoint = pt;
            snapType = SNAP_TYPE.OS_FEATURE;
          }
        } else if (type === 'MultiPolygon') {
          geom.getPolygons().forEach(poly => {
            const ring = poly.getLinearRing(0);
            const pt = ring.getClosestPoint(coordinate);
            const dist = getDistance(coordinate, pt);
            if (dist < minDistance && dist < tolerance) {
              minDistance = dist;
              snapPoint = pt;
              snapType = SNAP_TYPE.OS_FEATURE;
            }
          });
        }
      });
    }

    // Post-processing: If we snapped to an edge, check if the computed point
    // is very close to an exact vertex and use that instead.
    // This prevents floating-point precision issues from creating "slivers"
    if (snapPoint && (snapType === SNAP_TYPE.BOUNDARY_EDGE || 
                      snapType === SNAP_TYPE.PARCEL_EDGE || 
                      snapType === SNAP_TYPE.OS_FEATURE)) {
      const exactVertex = findNearestExactVertex(snapPoint, tolerance * 0.1);
      if (exactVertex.vertex) {
        snapPoint = exactVertex.vertex;
        snapType = exactVertex.type;
      }
    }

    // Return coordinate and snap type
    const result = {
      coordinate: snapPoint || coordinate,
      snapType: snapPoint ? snapType : SNAP_TYPE.NONE
    };
    
    // Log snap events for debugging (only when snap type changes)
    if (result.snapType !== lastSnapType) {
      if (result.snapType !== SNAP_TYPE.NONE) {
        console.log(`🧲 Snapping to: ${result.snapType} (distance: ${minDistance.toFixed(2)}m)`);
      } else if (lastSnapType !== SNAP_TYPE.NONE) {
        console.log('⭕ Snap released');
      }
    }
    
    return result;
  }

  /**
   * Find the nearest exact vertex to a given point
   * Used to correct edge snap points to exact vertex coordinates
   * @param {Array} point - [x, y] coordinate to check
   * @param {number} tolerance - Maximum distance to consider for snapping
   * @returns {Object} { vertex: [x,y] or null, type: SNAP_TYPE }
   */
  function findNearestExactVertex(point, tolerance) {
    let nearestVertex = null;
    let nearestType = SNAP_TYPE.NONE;
    let minDistance = Infinity;

    // Check boundary vertices
    if (currentMode === 'habitat-parcels' && boundaryPolygon) {
      const boundaryCoords = boundaryPolygon.getCoordinates()[0];
      for (let i = 0; i < boundaryCoords.length - 1; i++) {
        const vertex = boundaryCoords[i];
        const dist = getDistance(point, vertex);
        if (dist < minDistance && dist < tolerance) {
          minDistance = dist;
          nearestVertex = vertex;
          nearestType = SNAP_TYPE.BOUNDARY_VERTEX;
        }
      }
    }

    // Check parcel vertices
    if (currentMode === 'habitat-parcels' && habitatParcels.length > 0) {
      habitatParcels.forEach((parcel, index) => {
        if (index === editingParcelIndex) return;
        if (isDrawing && index === currentParcelIndex) return;

        const parcelGeom = parcel.feature.getGeometry();
        if (!parcelGeom) return;

        const parcelCoords = parcelGeom.getCoordinates()[0];
        for (let i = 0; i < parcelCoords.length - 1; i++) {
          const vertex = parcelCoords[i];
          const dist = getDistance(point, vertex);
          if (dist < minDistance && dist < tolerance) {
            minDistance = dist;
            nearestVertex = vertex;
            nearestType = SNAP_TYPE.PARCEL_VERTEX;
          }
        }
      });
    }

    return { vertex: nearestVertex, type: nearestType };
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
   * Update hover marker position with snap type styling
   */
  function updateHoverMarker(coordinate, snapType) {
    hoverSource.clear();
    
    if (isDrawing) {
      hoverFeature = new ol.Feature({
        geometry: new ol.geom.Point(coordinate),
        snapType: snapType || SNAP_TYPE.NONE
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

    // Stop any current parcel editing first
    if (editingParcelIndex >= 0) {
      stopEditingParcel();
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
      if (window.ParcelValidation && window.ParcelValidation.validateParcel) {
        const validationResult = window.ParcelValidation.validateParcel(
          completedPolygon, 
          boundaryPolygon, 
          habitatParcels, 
          habitatParcels.length - 1
        );
        if (!validationResult.valid) {
          console.warn('⚠️ Parcel has validation issues:', validationResult.error);
          if (onValidationError) {
            onValidationError(`Warning: ${validationResult.error} You can edit the parcel before saving.`);
          }
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
   * Validate all habitat parcels before saving
   * Wrapper function that calls the validation module with internal state
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateAllParcels() {
    if (window.ParcelValidation && window.ParcelValidation.validateAllParcels) {
      return window.ParcelValidation.validateAllParcels(habitatParcels, boundaryPolygon);
    }
    // Fallback if validation module not loaded
    return { valid: true, errors: [] };
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
    // Allow editing if polygon is complete (red-line boundary mode) or if editing a parcel
    const canEdit = (polygonComplete && !isDrawing) || (editingParcelIndex >= 0);
    
    if (!canEdit) {
      return;
    }

    if (ghostVertex && ghostVertexCoord && ghostVertexInsertIndex >= 0) {
      insertNewVertex(ghostVertexCoord, ghostVertexInsertIndex);
      clearGhostVertex();
      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    // Find vertex - only consider vertices of the parcel being edited
    const feature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        // In parcel editing mode, only allow dragging vertices of the current parcel
        if (editingParcelIndex >= 0) {
          const parcel = habitatParcels[editingParcelIndex];
          if (parcel.vertices.includes(feature)) {
            return feature;
          }
        } else {
          // Red-line boundary mode
          return feature;
        }
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

    // Note: snapCoord is already clamped to boundary in handlePointerMove if needed

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
    
    // Update parcel data if editing a parcel
    if (editingParcelIndex >= 0) {
      const parcel = habitatParcels[editingParcelIndex];
      parcel.coords = [...currentPolygonCoords];
      
      // Update the individual parcel area display
      updateParcelAreaDisplay(editingParcelIndex);
      updateTotalArea();
    } else {
      updateAreaDisplay();
    }
  }

  /**
   * Clamp a coordinate to be within the boundary polygon
   * If the coordinate is outside the boundary, return the closest point on the boundary edge
   * @param {Array} coordinate - The coordinate to clamp [x, y]
   * @returns {Array} - The clamped coordinate
   */
  function clampToBoundary(coordinate) {
    if (!boundaryPolygon) {
      return coordinate;
    }

    // Check if point is inside the boundary
    if (boundaryPolygon.intersectsCoordinate(coordinate)) {
      return coordinate;  // Point is inside, no clamping needed
    }

    // Point is outside - find closest point on boundary edge
    const ring = boundaryPolygon.getLinearRing(0);
    const closestPoint = ring.getClosestPoint(coordinate);
    
    return closestPoint;
  }

  /**
   * Update the area display for a specific parcel
   * @param {number} index - Parcel index
   */
  function updateParcelAreaDisplay(index) {
    const parcelAreaElement = document.getElementById(`parcel-area-${index}`);
    if (parcelAreaElement && habitatParcels[index]) {
      const geom = habitatParcels[index].feature.getGeometry();
      const areaSqMeters = geom.getArea();
      const areaHectares = roundToTwoDecimals(areaSqMeters / 10000);
      parcelAreaElement.textContent = areaHectares.toFixed(2);
    }
  }

  /**
   * Check if hovering over any vertex in edit mode
   */
  function checkVertexHover(pixel) {
    // Clear hover state on all vertices being edited
    placedVertices.forEach(v => {
      if (v.get('hovered')) {
        v.set('hovered', false);
        v.changed();
      }
    });

    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      if (feature.get('type') === 'vertex') {
        // In parcel editing mode, only hover vertices of the current parcel
        if (editingParcelIndex >= 0) {
          const parcel = habitatParcels[editingParcelIndex];
          if (parcel.vertices.includes(feature)) {
            return feature;
          }
        } else if (placedVertices.includes(feature)) {
          // Red-line boundary mode
          return feature;
        }
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
        // In parcel editing mode, only check vertices of the current parcel
        if (editingParcelIndex >= 0) {
          const parcel = habitatParcels[editingParcelIndex];
          if (parcel.vertices.includes(feature)) {
            return feature;
          }
        } else if (placedVertices.includes(feature)) {
          // Red-line boundary mode
          return feature;
        }
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
    // Check if we have a polygon to edit
    const canEdit = (polygonFeature && polygonComplete) || (editingParcelIndex >= 0);
    
    if (!canEdit) {
      clearGhostVertex();
      return;
    }

    // Find the polygon feature to check
    const feature = map.forEachFeatureAtPixel(pixel, (feature) => {
      const featureType = feature.get('type');
      if (featureType === 'polygon' || featureType === 'parcel') {
        // In parcel editing mode, only consider the parcel being edited
        if (editingParcelIndex >= 0) {
          const parcel = habitatParcels[editingParcelIndex];
          if (feature === parcel.feature) {
            return feature;
          }
        } else {
          // Red-line boundary mode
          return feature;
        }
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

    // Update parcel data if editing a parcel
    if (editingParcelIndex >= 0) {
      const parcel = habitatParcels[editingParcelIndex];
      parcel.coords = [...currentPolygonCoords];
      parcel.vertices = [...placedVertices];
      
      updateParcelAreaDisplay(editingParcelIndex);
      updateTotalArea();
    } else {
      updateAreaDisplay();
    }
  }

  /**
   * Helper function to enable/disable control elements (buttons or links)
   */
  function setControlEnabled(element, enabled) {
    if (!element) return;
    
    if (element.tagName === 'BUTTON') {
      element.disabled = !enabled;
    } else if (element.tagName === 'A') {
      if (enabled) {
        element.classList.remove('disabled');
      } else {
        element.classList.add('disabled');
      }
    }
  }

  /**
   * Update UI buttons when polygon is complete (red-line-boundary mode)
   */
  function updateUIForCompletePolygon() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const clearButton = document.getElementById('clear-polygon');
    const saveButton = document.getElementById('save-boundary');
    const startFillButton = document.getElementById('start-fill');
    
    if (startButton) startButton.parentElement.style.display = 'none';
    if (cancelButton) cancelButton.parentElement.style.display = 'none';
    if (clearButton) clearButton.parentElement.style.display = 'block';
    // Keep fill button visible so user can add more polygons or replace
    if (startFillButton) startFillButton.parentElement.style.display = 'block';
    setControlEnabled(saveButton, true);
  }

  /**
   * Update UI for habitat-parcels mode
   */
  function updateUIForHabitatParcels() {
    const startButton = document.getElementById('start-drawing');
    const cancelButton = document.getElementById('cancel-drawing');
    const saveParcelsButton = document.getElementById('save-parcels');

    if (startButton) startButton.parentElement.style.display = 'block';
    if (cancelButton) cancelButton.parentElement.style.display = 'none';
    setControlEnabled(saveParcelsButton, habitatParcels.length > 0);

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
      const areaHectares = roundToTwoDecimals(areaSqMeters / 10000);
      const colors = PARCEL_COLORS[parcel.colorIndex % PARCEL_COLORS.length];
      const isEditing = editingParcelIndex === index;
      const isAnotherEditing = editingParcelIndex >= 0 && editingParcelIndex !== index;

      // Edit/Done button
      let editButton = '';
      if (isEditing) {
        editButton = `<button type="button" class="govuk-link" style="color: #00703c; cursor: pointer; border: none; background: none; font-weight: bold;" onclick="window.SnapDrawing.stopEditingParcel()">Done</button>`;
      } else if (!isAnotherEditing && !isDrawing) {
        editButton = `<button type="button" class="govuk-link" style="color: #1d70b8; cursor: pointer; border: none; background: none;" onclick="window.SnapDrawing.startEditingParcel(${index})">Edit</button>`;
      }

      // Remove button (only show if not editing another parcel)
      let removeButton = '';
      if (!isAnotherEditing && !isDrawing) {
        removeButton = `<button type="button" class="govuk-link" style="color: #d4351c; cursor: pointer; border: none; background: none; margin-left: 10px;" onclick="window.SnapDrawing.removeParcel(${index})">Remove</button>`;
      }

      // Highlight the row if editing
      const rowStyle = isEditing 
        ? 'display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid #b1b4b6; background: #fef7e5; margin: -8px; margin-bottom: 0; padding: 8px;'
        : 'display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #b1b4b6;';

      return `
        <li class="govuk-body-s" style="${rowStyle}">
          <span style="display: flex; align-items: center;">
            <span style="width: 16px; height: 16px; background: ${colors.fill}; border: 2px solid ${colors.stroke}; margin-right: 8px;"></span>
            Parcel ${index + 1}: <span id="parcel-area-${index}">${areaHectares.toFixed(2)}</span> ha
          </span>
          <span>
            ${editButton}
            ${removeButton}
          </span>
        </li>
      `;
    }).join('');
  }

  /**
   * Update total area display including boundary area and remaining area
   */
  function updateTotalArea() {
    const totalAreaElement = document.getElementById('total-area');
    
    // Calculate total parcel area in sq meters
    const totalParcelAreaSqM = habitatParcels.reduce((sum, parcel) => {
      const geom = parcel.feature.getGeometry();
      return sum + geom.getArea();
    }, 0);

    // Convert to hectares and round to 2 decimal places for consistent display
    const totalParcelHectares = roundToTwoDecimals(totalParcelAreaSqM / 10000);
    
    if (totalAreaElement) {
      totalAreaElement.textContent = totalParcelHectares.toFixed(2);
    }

    // Calculate and display remaining area
    const remainingValueElement = document.getElementById('remaining-area-value');
    const remainingWarningElement = document.getElementById('remaining-area-warning');
    
    if (remainingValueElement && boundaryPolygon) {
      const boundaryAreaSqM = boundaryPolygon.getArea();
      const boundaryHectares = roundToTwoDecimals(boundaryAreaSqM / 10000);
      
      // Calculate remaining using the same rounded values that are displayed
      // This ensures consistency between what users see and the calculation
      const remainingHectares = roundToTwoDecimals(boundaryHectares - totalParcelHectares);
      
      // Update styling and text based on remaining area
      if (remainingHectares === 0) {
        // All area assigned exactly
        remainingValueElement.style.color = '#00703c';  // Green
        remainingValueElement.textContent = '0.00';
        if (remainingWarningElement) remainingWarningElement.style.display = 'none';
      } else if (remainingHectares < 0) {
        // Over-assigned - show negative value in red with warning on separate line
        remainingValueElement.style.color = '#d4351c';  // Red
        remainingValueElement.textContent = remainingHectares.toFixed(2);
        if (remainingWarningElement) remainingWarningElement.style.display = 'block';
      } else {
        // Some area remaining - show in red to indicate incomplete
        remainingValueElement.style.color = '#d4351c';
        remainingValueElement.textContent = remainingHectares.toFixed(2);
        if (remainingWarningElement) remainingWarningElement.style.display = 'none';
      }
    }
  }

  /**
   * Round a number to 2 decimal places consistently
   * Uses Math.round to avoid floating point precision issues
   * @param {number} value - The value to round
   * @returns {number} - The rounded value
   */
  function roundToTwoDecimals(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * Update the boundary area display
   */
  function updateBoundaryAreaDisplay() {
    const boundaryAreaElement = document.getElementById('boundary-area');
    
    if (boundaryAreaElement && boundaryPolygon) {
      const boundaryArea = boundaryPolygon.getArea();
      const boundaryHectares = roundToTwoDecimals(boundaryArea / 10000);
      boundaryAreaElement.textContent = boundaryHectares.toFixed(2);
    }
  }

  /**
   * Get boundary area in hectares
   * @returns {number|null} Area in hectares or null if no boundary
   */
  function getBoundaryAreaHectares() {
    if (!boundaryPolygon) return null;
    return boundaryPolygon.getArea() / 10000;
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

    // Stop editing if we're removing the parcel being edited
    if (editingParcelIndex === index) {
      stopEditingParcel();
    } else if (editingParcelIndex > index) {
      // Adjust editing index if removing a parcel before it
      editingParcelIndex--;
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
   * Start editing a parcel
   * @param {number} index - Index of parcel to edit
   */
  function startEditingParcel(index) {
    if (index < 0 || index >= habitatParcels.length) {
      console.warn('Invalid parcel index:', index);
      return;
    }

    if (isDrawing) {
      console.warn('Cannot edit while drawing');
      return;
    }

    // Stop editing any previous parcel
    if (editingParcelIndex >= 0) {
      stopEditingParcel();
    }

    editingParcelIndex = index;
    const parcel = habitatParcels[index];

    // Set up editing state for this parcel
    polygonFeature = parcel.feature;
    currentPolygonCoords = [...parcel.coords];
    placedVertices = [...parcel.vertices];
    polygonComplete = true;
    isEditing = true;

    // Trigger style refresh to show vertices for the parcel being edited
    parcel.vertices.forEach(v => {
      v.set('editing', true);
      v.changed();
    });
    
    // Force redraw to show/hide vertices
    drawLayer.changed();

    console.log(`✏️ Editing parcel ${index + 1}`);

    // Hide Add Parcel button while editing
    const startButton = document.getElementById('start-drawing');
    if (startButton) {
      startButton.style.display = 'none';
    }

    updateParcelsList();
  }

  /**
   * Stop editing the current parcel
   */
  function stopEditingParcel() {
    if (editingParcelIndex < 0) {
      return;
    }

    const parcel = habitatParcels[editingParcelIndex];

    // Update parcel data with any changes
    parcel.coords = [...currentPolygonCoords];
    
    // Update the feature geometry
    parcel.feature.getGeometry().setCoordinates([currentPolygonCoords]);

    // Hide vertex editing state
    parcel.vertices.forEach(v => {
      v.set('editing', false);
      v.set('hovered', false);
      v.changed();
    });

    console.log(`✓ Finished editing parcel ${editingParcelIndex + 1}`);

    // Reset editing state
    editingParcelIndex = -1;
    polygonFeature = null;
    currentPolygonCoords = [];
    placedVertices = [];
    polygonComplete = false;
    isEditing = false;
    clearGhostVertex();
    
    // Force redraw to hide vertices
    drawLayer.changed();

    // Show Add Parcel button again
    const startButton = document.getElementById('start-drawing');
    if (startButton) {
      startButton.style.display = 'inline-block';
    }

    updateParcelsList();
    updateTotalArea();
  }

  /**
   * Check if currently editing a parcel
   * @returns {boolean}
   */
  function isEditingParcel() {
    return editingParcelIndex >= 0;
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
    
    if (startButton) startButton.parentElement.style.display = 'block';
    if (cancelButton) cancelButton.parentElement.style.display = 'none';
    if (clearButton) clearButton.parentElement.style.display = 'none';
    setControlEnabled(saveButton, false);
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
   * Set polygon from external coordinates (used by Fill tool)
   * Creates a completed polygon from the provided coordinate array
   * @param {Array} coords - Array of [x, y] coordinates (closed ring)
   */
  function setPolygonFromCoordinates(coords) {
    if (!coords || coords.length < 4) {
      console.error('Invalid coordinates for polygon');
      return false;
    }

    // Clear any existing polygon
    if (polygonComplete || isDrawing) {
      clearPolygon();
    }

    console.log(`Setting polygon from ${coords.length - 1} vertices`);

    // Set state
    currentPolygonCoords = coords.map(c => [...c]);
    placedVertices = [];

    // Create vertex features for each coordinate (except the closing duplicate)
    for (let i = 0; i < coords.length - 1; i++) {
      const vertexFeature = new ol.Feature({
        geometry: new ol.geom.Point(coords[i]),
        type: 'vertex',
        isFirst: i === 0,
        highlighted: false,
        colorIndex: 0
      });
      placedVertices.push(vertexFeature);
      drawSource.addFeature(vertexFeature);
    }

    // Create the polygon feature
    const completedPolygon = new ol.geom.Polygon([currentPolygonCoords]);
    polygonFeature = new ol.Feature({
      geometry: completedPolygon,
      type: 'polygon',
      colorIndex: 0
    });
    drawSource.addFeature(polygonFeature);

    // Set state to complete
    isDrawing = false;
    polygonComplete = true;
    isEditing = true;
    canClosePolygon = false;

    // Update UI
    updateUIForCompletePolygon();
    updateAreaDisplay();

    console.log('✓ Polygon set from coordinates');

    if (onPolygonComplete) {
      onPolygonComplete();
    }

    return true;
  }

  /**
   * Enable or disable snapping to boundary vertices
   */
  function setSnapToBoundaryVertices(enabled) {
    snapToBoundaryVertices = enabled;
    console.log(enabled ? '🧲 Boundary vertex snapping enabled' : '🚫 Boundary vertex snapping disabled');
  }

  /**
   * Enable or disable snapping to boundary edges
   */
  function setSnapToBoundaryEdges(enabled) {
    snapToBoundaryEdges = enabled;
    console.log(enabled ? '🧲 Boundary edge snapping enabled' : '🚫 Boundary edge snapping disabled');
  }

  /**
   * Enable or disable snapping to parcel vertices
   */
  function setSnapToParcelVertices(enabled) {
    snapToParcelVertices = enabled;
    console.log(enabled ? '🧲 Parcel vertex snapping enabled' : '🚫 Parcel vertex snapping disabled');
  }

  /**
   * Enable or disable snapping to parcel edges
   */
  function setSnapToParcelEdges(enabled) {
    snapToParcelEdges = enabled;
    console.log(enabled ? '🧲 Parcel edge snapping enabled' : '🚫 Parcel edge snapping disabled');
  }

  /**
   * Get current snap settings
   */
  function getSnapSettings() {
    return {
      osFeatures: snappingEnabled,
      boundaryVertices: snapToBoundaryVertices,
      boundaryEdges: snapToBoundaryEdges,
      parcelVertices: snapToParcelVertices,
      parcelEdges: snapToParcelEdges
    };
  }

  /**
   * Enable or disable ALL boundary snapping (legacy function for backward compatibility)
   * Controls both vertices and edges together
   */
  function setBoundarySnappingEnabled(enabled) {
    snapToBoundaryVertices = enabled;
    snapToBoundaryEdges = enabled;
    console.log(enabled ? '🧲 Boundary snapping enabled (all)' : '🚫 Boundary snapping disabled (all)');
  }

  /**
   * Check if boundary snapping is currently enabled (legacy function)
   */
  function isBoundarySnappingEnabled() {
    return snapToBoundaryVertices || snapToBoundaryEdges;
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
    startEditingParcel: startEditingParcel,
    stopEditingParcel: stopEditingParcel,
    isEditingParcel: isEditingParcel,
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
    // Fill tool integration
    setPolygonFromCoordinates: setPolygonFromCoordinates,
    // New fine-grained snap controls
    setSnapToBoundaryVertices: setSnapToBoundaryVertices,
    setSnapToBoundaryEdges: setSnapToBoundaryEdges,
    setSnapToParcelVertices: setSnapToParcelVertices,
    setSnapToParcelEdges: setSnapToParcelEdges,
    getSnapSettings: getSnapSettings,
    // Legacy boundary snapping (for backward compatibility)
    setBoundarySnappingEnabled: setBoundarySnappingEnabled,
    isBoundarySnappingEnabled: isBoundarySnappingEnabled,
    // Validation functions (wraps validation module with internal state)
    validateAllParcels: validateAllParcels,
    getBoundaryAreaHectares: getBoundaryAreaHectares,
    // Internal state accessors for validation
    getHabitatParcels: () => habitatParcels,
    getBoundaryPolygon: () => boundaryPolygon,
    getDrawSource: () => drawSource,
    // Snap index source for fill tool
    getSnapIndexSource: () => snapIndexSource
  };

})(window);
