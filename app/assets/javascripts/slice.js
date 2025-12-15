//
// Slice Tool module for splitting polygons in habitat parcels mode
// Allows users to split the red-line boundary or existing habitat parcels
// by drawing a straight line between two points on the same polygon.
// Supports snapping to both vertices AND edges.
//

(function(window) {
  'use strict';

  // Configuration
  const SNAP_TOLERANCE_PX = 25;

  // Parcel colors
  const PARCEL_COLORS = [
    { stroke: 'rgba(29, 112, 184, 1)', fill: 'rgba(29, 112, 184, 0.2)' },
    { stroke: 'rgba(0, 112, 60, 1)', fill: 'rgba(0, 112, 60, 0.2)' },
    { stroke: 'rgba(128, 51, 153, 1)', fill: 'rgba(128, 51, 153, 0.2)' },
    { stroke: 'rgba(212, 53, 28, 1)', fill: 'rgba(212, 53, 28, 0.2)' },
    { stroke: 'rgba(255, 152, 0, 1)', fill: 'rgba(255, 152, 0, 0.2)' },
    { stroke: 'rgba(0, 150, 136, 1)', fill: 'rgba(0, 150, 136, 0.2)' },
    { stroke: 'rgba(233, 30, 99, 1)', fill: 'rgba(233, 30, 99, 0.2)' },
    { stroke: 'rgba(63, 81, 181, 1)', fill: 'rgba(63, 81, 181, 0.2)' },
  ];

  // Module state
  let map = null;
  let sliceLayer = null;
  let sliceSource = null;
  let sliceMode = false;
  
  // Start point info
  let startPoint = null;
  let startMarkerFeature = null;
  
  // Current hover
  let hoverMarkerFeature = null;
  let previewLineFeature = null;

  // Source polygon info
  let sourceType = null;
  let sourceParcelIndex = -1;
  let sourceCoords = null;

  // Callbacks
  let onSliceComplete = null;
  let onSliceCancel = null;
  let onStatusMessage = null;

  // Styles - matching snapping.js colors
  const BOUNDARY_VERTEX_STYLE = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 8,
      fill: new ol.style.Fill({ color: 'rgba(212, 53, 28, 0.9)' }),  // Red for boundary vertex
      stroke: new ol.style.Stroke({ color: 'white', width: 2 })
    })
  });

  const PARCEL_VERTEX_STYLE = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 8,
      fill: new ol.style.Fill({ color: 'rgba(174, 37, 115, 0.9)' }),  // Magenta for parcel vertex
      stroke: new ol.style.Stroke({ color: 'white', width: 2 })
    })
  });

  const EDGE_SNAP_STYLE = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({ color: 'rgba(255, 140, 0, 0.9)' }),  // Orange for edge
      stroke: new ol.style.Stroke({ color: 'white', width: 2 })
    })
  });

  const START_POINT_STYLE = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 9,
      fill: new ol.style.Fill({ color: 'rgba(0, 184, 255, 0.9)' }),  // Cyan for start
      stroke: new ol.style.Stroke({ color: 'white', width: 2 })
    })
  });

  const SLICE_LINE_STYLE = new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: 'rgba(0, 184, 255, 1)',
      width: 2,
      lineDash: [12, 8]
    })
  });

  /**
   * Initialize the slice tool
   */
  function initSliceTool(olMap, callbacks = {}) {
    if (!olMap) {
      console.error('❌ Slice tool: No map provided');
      return;
    }
    
    map = olMap;
    onSliceComplete = callbacks.onSliceComplete || null;
    onSliceCancel = callbacks.onSliceCancel || null;
    onStatusMessage = callbacks.onStatusMessage || null;

    // Create slice visualization layer
    sliceSource = new ol.source.Vector();
    sliceLayer = new ol.layer.Vector({
      source: sliceSource,
      style: function(feature) {
        const ft = feature.get('featureType');
        if (ft === 'boundary-vertex-hover') return BOUNDARY_VERTEX_STYLE;
        if (ft === 'parcel-vertex-hover') return PARCEL_VERTEX_STYLE;
        if (ft === 'edge-hover') return EDGE_SNAP_STYLE;
        if (ft === 'start') return START_POINT_STYLE;
        if (ft === 'line') return SLICE_LINE_STYLE;
        return null;
      },
      zIndex: 1000
    });
    map.addLayer(sliceLayer);
    
    console.log('✓ Slice tool initialized');

    // Add event listeners
    map.on('pointermove', handlePointerMove);
    map.on('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Start slice mode
   */
  function startSliceMode() {
    if (sliceMode) {
      console.warn('Already in slice mode');
      return;
    }

    const boundaryPolygon = window.SnapDrawing && window.SnapDrawing.getBoundaryPolygon();
    if (!boundaryPolygon) {
      showStatus('No boundary loaded. Please define a red line boundary first.', 'error');
      return;
    }

    sliceMode = true;
    startPoint = null;
    sourceType = null;
    sourceParcelIndex = -1;
    sourceCoords = null;
    
    clearSliceVisuals();
    map.getTargetElement().style.cursor = 'crosshair';
    
    // Check if there are parcels to slice
    const parcels = window.SnapDrawing && window.SnapDrawing.getHabitatParcels();
    if (parcels && parcels.length > 0) {
      showStatus('Slice mode: Click on a parcel or the red-line boundary to start.', 'info');
    } else {
      showStatus('Slice mode: Click anywhere on the red-line boundary to start.', 'info');
    }
    
    console.log('✂️ Slice mode ACTIVE');
    updateSliceUI(true);
  }

  /**
   * Cancel slice mode
   */
  function cancelSlice() {
    if (!sliceMode) return;

    sliceMode = false;
    startPoint = null;
    sourceType = null;
    sourceParcelIndex = -1;
    sourceCoords = null;

    clearSliceVisuals();
    map.getTargetElement().style.cursor = 'default';
    showStatus('Slice cancelled', 'info');
    
    console.log('✂️ Slice cancelled');
    updateSliceUI(false);

    if (onSliceCancel) onSliceCancel();
  }

  /**
   * Clear all slice visualization features
   */
  function clearSliceVisuals() {
    if (sliceSource) sliceSource.clear();
    hoverMarkerFeature = null;
    startMarkerFeature = null;
    previewLineFeature = null;
  }

  /**
   * Handle pointer move
   */
  function handlePointerMove(evt) {
    if (!sliceMode) return;

    const coordinate = evt.coordinate;
    
    // Find snap point on boundary (vertex or edge)
    const snapInfo = findSnapPoint(coordinate);

    // Remove old hover marker
    if (hoverMarkerFeature) {
      sliceSource.removeFeature(hoverMarkerFeature);
      hoverMarkerFeature = null;
    }

    // Show hover marker if we found a snap point
    if (snapInfo) {
      // Determine the feature type for styling
      let featureType;
      if (snapInfo.isVertex) {
        featureType = snapInfo.sourceType === 'parcel' ? 'parcel-vertex-hover' : 'boundary-vertex-hover';
      } else {
        featureType = 'edge-hover';
      }
      
      hoverMarkerFeature = new ol.Feature({
        geometry: new ol.geom.Point(snapInfo.coordinate),
        featureType: featureType
      });
      sliceSource.addFeature(hoverMarkerFeature);
      map.getTargetElement().style.cursor = 'pointer';
    } else {
      map.getTargetElement().style.cursor = 'crosshair';
    }

    // Update preview line if we have a start point
    if (startPoint) {
      if (previewLineFeature) {
        sliceSource.removeFeature(previewLineFeature);
      }
      
      const endCoord = snapInfo ? snapInfo.coordinate : coordinate;
      previewLineFeature = new ol.Feature({
        geometry: new ol.geom.LineString([startPoint.coordinate, endCoord]),
        featureType: 'line'
      });
      sliceSource.addFeature(previewLineFeature);
    }
  }

  /**
   * Handle click
   */
  function handleClick(evt) {
    if (!sliceMode) return;

    const coordinate = evt.coordinate;
    const snapInfo = findSnapPoint(coordinate);

    if (!startPoint) {
      // First click - select start point
      if (!snapInfo) {
        showStatus('Please click on a boundary or parcel edge.', 'warning');
        return;
      }

      startPoint = snapInfo;
      sourceType = snapInfo.sourceType;
      sourceParcelIndex = snapInfo.parcelIndex;
      sourceCoords = snapInfo.polygonCoords.slice();

      // Show start marker
      startMarkerFeature = new ol.Feature({
        geometry: new ol.geom.Point(startPoint.coordinate),
        featureType: 'start'
      });
      sliceSource.addFeature(startMarkerFeature);

      const sourceDesc = sourceType === 'boundary' 
        ? 'red-line boundary' 
        : `Parcel ${sourceParcelIndex + 1}`;
      
      showStatus(`Start point on ${sourceDesc}. Now click another point on the same ${sourceType === 'boundary' ? 'boundary' : 'parcel'} to slice.`, 'info');
      console.log('✂️ Start point on', sourceDesc, '- isVertex:', startPoint.isVertex, 'edgeIndex:', startPoint.edgeIndex);

    } else {
      // Second click - complete the slice
      if (!snapInfo) {
        showStatus('Please click on the same polygon to complete the slice.', 'warning');
        return;
      }

      // Must be on the same polygon type and index
      if (snapInfo.sourceType !== sourceType) {
        const targetDesc = sourceType === 'boundary' ? 'boundary' : `Parcel ${sourceParcelIndex + 1}`;
        showStatus(`End point must be on the same ${targetDesc}.`, 'warning');
        return;
      }

      if (sourceType === 'parcel' && snapInfo.parcelIndex !== sourceParcelIndex) {
        showStatus(`End point must be on Parcel ${sourceParcelIndex + 1}.`, 'warning');
        return;
      }

      // Check that points are not too close
      const dist = getDistance(startPoint.coordinate, snapInfo.coordinate);
      if (dist < 1) {
        showStatus('Please select a different point.', 'warning');
        return;
      }

      console.log('✂️ End point - isVertex:', snapInfo.isVertex, 'edgeIndex:', snapInfo.edgeIndex);
      executeSlice(startPoint, snapInfo);
    }
  }

  /**
   * Find snap point on boundary or parcel (checks PARCELS FIRST - higher layer priority)
   */
  function findSnapPoint(coordinate) {
    const resolution = map.getView().getResolution();
    const tolerance = SNAP_TOLERANCE_PX * resolution;

    let result = null;
    let minDist = Infinity;

    // Check PARCELS FIRST (higher layer priority - when parcel and boundary share an edge)
    const parcels = window.SnapDrawing && window.SnapDrawing.getHabitatParcels();
    if (parcels && parcels.length > 0) {
      for (let p = 0; p < parcels.length; p++) {
        const geom = parcels[p].feature.getGeometry();
        if (!geom) continue;
        const coords = geom.getCoordinates()[0];

        // Check vertices first (higher priority than edges)
        for (let i = 0; i < coords.length - 1; i++) {
          const dist = getDistance(coordinate, coords[i]);
          if (dist < tolerance && dist < minDist) {
            minDist = dist;
            result = {
              coordinate: coords[i],
              edgeIndex: i,
              isVertex: true,
              sourceType: 'parcel',
              parcelIndex: p,
              polygonCoords: coords
            };
          }
        }

        // Check edges if no vertex found yet
        if (!result || result.sourceType !== 'parcel' || result.parcelIndex !== p) {
          for (let i = 0; i < coords.length - 1; i++) {
            const closest = closestPointOnSegment(coordinate, coords[i], coords[i + 1]);
            const dist = getDistance(coordinate, closest);
            
            if (dist < tolerance && dist < minDist) {
              minDist = dist;
              result = {
                coordinate: closest,
                edgeIndex: i,
                isVertex: false,
                sourceType: 'parcel',
                parcelIndex: p,
                polygonCoords: coords
              };
            }
          }
        }
      }
    }

    // If we found a parcel snap point, return it (parcel takes priority)
    if (result && result.sourceType === 'parcel') {
      return result;
    }

    // Otherwise check boundary
    const boundaryPolygon = window.SnapDrawing && window.SnapDrawing.getBoundaryPolygon();
    if (boundaryPolygon) {
      const coords = boundaryPolygon.getCoordinates()[0];
      
      // Check vertices first (higher priority)
      for (let i = 0; i < coords.length - 1; i++) {
        const dist = getDistance(coordinate, coords[i]);
        if (dist < tolerance && dist < minDist) {
          minDist = dist;
          result = {
            coordinate: coords[i],
            edgeIndex: i,
            isVertex: true,
            sourceType: 'boundary',
            parcelIndex: -1,
            polygonCoords: coords
          };
        }
      }

      // If no vertex found, check edges
      if (!result) {
        for (let i = 0; i < coords.length - 1; i++) {
          const edgeStart = coords[i];
          const edgeEnd = coords[i + 1];
          const closest = closestPointOnSegment(coordinate, edgeStart, edgeEnd);
          const dist = getDistance(coordinate, closest);
          
          if (dist < tolerance && dist < minDist) {
            minDist = dist;
            result = {
              coordinate: closest,
              edgeIndex: i,
              isVertex: false,
              sourceType: 'boundary',
              parcelIndex: -1,
              polygonCoords: coords
            };
          }
        }
      }
    }

    return result;
  }

  /**
   * Find closest point on a line segment
   */
  function closestPointOnSegment(point, segStart, segEnd) {
    const dx = segEnd[0] - segStart[0];
    const dy = segEnd[1] - segStart[1];
    
    if (dx === 0 && dy === 0) {
      return [...segStart];
    }

    const t = Math.max(0, Math.min(1, 
      ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) / (dx * dx + dy * dy)
    ));
    
    return [segStart[0] + t * dx, segStart[1] + t * dy];
  }

  /**
   * Calculate distance between two coordinates
   */
  function getDistance(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Execute the slice operation
   */
  function executeSlice(start, end) {
    console.log('✂️ Executing slice...');
    
    // Get the original polygon coords (without closing vertex)
    const originalCoords = sourceCoords.slice(0, -1);
    
    // Build a new coordinate array with slice points inserted at the right positions
    const newCoords = [];
    let startInserted = false;
    let endInserted = false;
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < originalCoords.length; i++) {
      const currentCoord = originalCoords[i];
      
      // Add current vertex
      newCoords.push([...currentCoord]);
      
      // Check if start point is this vertex
      if (!startInserted && start.isVertex && start.edgeIndex === i) {
        startIdx = newCoords.length - 1;
        startInserted = true;
      }
      
      // Check if end point is this vertex
      if (!endInserted && end.isVertex && end.edgeIndex === i) {
        endIdx = newCoords.length - 1;
        endInserted = true;
      }
      
      // Check if we need to insert start point on this edge (after current vertex)
      if (!startInserted && !start.isVertex && start.edgeIndex === i) {
        newCoords.push([...start.coordinate]);
        startIdx = newCoords.length - 1;
        startInserted = true;
      }
      
      // Check if we need to insert end point on this edge (after current vertex)
      if (!endInserted && !end.isVertex && end.edgeIndex === i) {
        newCoords.push([...end.coordinate]);
        endIdx = newCoords.length - 1;
        endInserted = true;
      }
    }

    console.log('✂️ New coords length:', newCoords.length, 'startIdx:', startIdx, 'endIdx:', endIdx);

    if (startIdx === -1 || endIdx === -1) {
      console.error('❌ Could not determine slice indices');
      showStatus('Error creating slice. Please try again.', 'error');
      return;
    }

    // Ensure i < j for consistent splitting
    let i = Math.min(startIdx, endIdx);
    let j = Math.max(startIdx, endIdx);

    // Create two polygons by splitting at i and j
    // Polygon A: vertices from i to j (inclusive), then close
    const polyACoords = [];
    for (let idx = i; idx <= j; idx++) {
      polyACoords.push([...newCoords[idx]]);
    }
    polyACoords.push([...newCoords[i]]); // Close the ring

    // Polygon B: vertices from j to end, then 0 to i (inclusive), then close
    const polyBCoords = [];
    for (let idx = j; idx < newCoords.length; idx++) {
      polyBCoords.push([...newCoords[idx]]);
    }
    for (let idx = 0; idx <= i; idx++) {
      polyBCoords.push([...newCoords[idx]]);
    }
    polyBCoords.push([...newCoords[j]]); // Close the ring

    console.log('✂️ Polygon A:', polyACoords.length - 1, 'vertices');
    console.log('✂️ Polygon B:', polyBCoords.length - 1, 'vertices');

    // Validate polygons have at least 3 vertices (4 coords including closing)
    if (polyACoords.length < 4 || polyBCoords.length < 4) {
      showStatus('Cannot create valid polygons from this slice. Try points further apart.', 'warning');
      return;
    }

    // Create the parcels
    if (sourceType === 'boundary') {
      createParcelsFromSlice([polyACoords, polyBCoords]);
    } else {
      replaceParcelWithSlice(sourceParcelIndex, polyACoords, polyBCoords);
    }

    // Clean up
    finishSlice();
  }

  /**
   * Create parcels from the slice (when slicing boundary)
   */
  function createParcelsFromSlice(coordsArrays) {
    const habitatParcels = window.SnapDrawing && window.SnapDrawing.getHabitatParcels();
    const drawSource = getDrawSource();
    
    if (!drawSource) {
      console.error('❌ Cannot find draw source');
      showStatus('Error creating parcels.', 'error');
      return;
    }

    console.log('✓ Found draw source, creating', coordsArrays.length, 'parcels');

    coordsArrays.forEach((coords, idx) => {
      const colorIndex = habitatParcels ? habitatParcels.length : idx;
      
      const polygon = new ol.geom.Polygon([coords]);
      const feature = new ol.Feature({
        geometry: polygon,
        type: 'parcel',
        colorIndex: colorIndex
      });
      drawSource.addFeature(feature);

      // Create vertex features
      const vertices = [];
      for (let i = 0; i < coords.length - 1; i++) {
        const vf = new ol.Feature({
          geometry: new ol.geom.Point(coords[i]),
          type: 'vertex',
          isFirst: i === 0,
          highlighted: false,
          colorIndex: colorIndex
        });
        vertices.push(vf);
        drawSource.addFeature(vf);
      }

      // Add to parcels array
      if (habitatParcels) {
        habitatParcels.push({
          feature: feature,
          coords: coords,
          vertices: vertices,
          colorIndex: colorIndex
        });
        console.log('✓ Created parcel', habitatParcels.length, 'with colorIndex', colorIndex, 'and', coords.length - 1, 'vertices');
      }
    });

    // Force the draw layer to refresh its styles
    const layers = map.getLayers().getArray();
    for (let layer of layers) {
      if (layer instanceof ol.layer.Vector && layer.getZIndex() === 50) {
        layer.changed();
        break;
      }
    }

    refreshParcelsUI();
  }

  /**
   * Replace a parcel with two new parcels
   */
  function replaceParcelWithSlice(parcelIndex, coordsA, coordsB) {
    const habitatParcels = window.SnapDrawing && window.SnapDrawing.getHabitatParcels();
    const drawSource = getDrawSource();
    
    if (!drawSource || !habitatParcels || parcelIndex < 0) {
      console.error('❌ Cannot replace parcel');
      return;
    }

    // Remove the original parcel
    const original = habitatParcels[parcelIndex];
    drawSource.removeFeature(original.feature);
    original.vertices.forEach(v => drawSource.removeFeature(v));
    habitatParcels.splice(parcelIndex, 1);

    // Create the new parcels
    createParcelsFromSlice([coordsA, coordsB]);
  }

  /**
   * Get the draw source from SnapDrawing (the layer with zIndex 50)
   */
  function getDrawSource() {
    // The draw layer in snapping.js has zIndex 50
    const layers = map.getLayers().getArray();
    for (let layer of layers) {
      if (layer instanceof ol.layer.Vector && layer !== sliceLayer) {
        const zIndex = layer.getZIndex();
        if (zIndex === 50) {
          return layer.getSource();
        }
      }
    }
    
    // Fallback: search for layer with parcel features
    for (let layer of layers) {
      if (layer instanceof ol.layer.Vector && layer !== sliceLayer) {
        const source = layer.getSource();
        if (source) {
          const features = source.getFeatures();
          for (let f of features) {
            const type = f.get('type');
            if (type === 'parcel' || type === 'polygon' || type === 'vertex') {
              return source;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Finish the slice operation
   */
  function finishSlice() {
    sliceMode = false;
    startPoint = null;
    sourceType = null;
    sourceParcelIndex = -1;
    sourceCoords = null;
    
    clearSliceVisuals();
    map.getTargetElement().style.cursor = 'default';
    updateSliceUI(false);
    showStatus('Slice complete! Two parcels created.', 'success');

    if (onSliceComplete) onSliceComplete();
  }

  /**
   * Refresh the parcels UI
   */
  function refreshParcelsUI() {
    const listElement = document.getElementById('parcels-list-items');
    const habitatParcels = window.SnapDrawing && window.SnapDrawing.getHabitatParcels();
    
    if (!listElement || !habitatParcels) return;

    if (habitatParcels.length === 0) {
      listElement.innerHTML = '<li class="govuk-body-s" style="color: #505a5f;">No parcels drawn yet</li>';
    } else {
      listElement.innerHTML = habitatParcels.map((parcel, index) => {
        const geom = parcel.feature.getGeometry();
        const areaHa = Math.round(geom.getArea() / 100) / 100;
        const colors = PARCEL_COLORS[parcel.colorIndex % PARCEL_COLORS.length];

        return `
          <li class="govuk-body-s" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #b1b4b6;">
            <span style="display: flex; align-items: center;">
              <span style="width: 16px; height: 16px; background: ${colors.fill}; border: 2px solid ${colors.stroke}; margin-right: 8px;"></span>
              Parcel ${index + 1}: ${areaHa.toFixed(2)} ha
            </span>
            <span>
              <button type="button" class="govuk-link" style="color: #1d70b8; cursor: pointer; border: none; background: none;" onclick="window.SnapDrawing.startEditingParcel(${index})">Edit</button>
              <button type="button" class="govuk-link" style="color: #d4351c; cursor: pointer; border: none; background: none; margin-left: 10px;" onclick="window.SnapDrawing.removeParcel(${index})">Remove</button>
            </span>
          </li>
        `;
      }).join('');
    }

    updateTotalArea(habitatParcels);
    
    const saveBtn = document.getElementById('save-parcels');
    if (saveBtn) {
      saveBtn.classList.toggle('disabled', habitatParcels.length === 0);
    }
  }

  /**
   * Update total area display
   */
  function updateTotalArea(habitatParcels) {
    const totalEl = document.getElementById('total-area');
    const remainingEl = document.getElementById('remaining-area-value');
    const warningEl = document.getElementById('remaining-area-warning');
    
    const totalSqM = habitatParcels.reduce((sum, p) => sum + p.feature.getGeometry().getArea(), 0);
    const totalHa = Math.round(totalSqM / 100) / 100;
    
    if (totalEl) totalEl.textContent = totalHa.toFixed(2);

    const boundary = window.SnapDrawing && window.SnapDrawing.getBoundaryPolygon();
    if (remainingEl && boundary) {
      const boundaryHa = Math.round(boundary.getArea() / 100) / 100;
      const remaining = Math.round((boundaryHa - totalHa) * 100) / 100;
      
      remainingEl.textContent = remaining.toFixed(2);
      remainingEl.style.color = remaining <= 0 ? (remaining < 0 ? '#d4351c' : '#00703c') : '#d4351c';
      if (warningEl) warningEl.style.display = remaining < 0 ? 'block' : 'none';
    }
  }

  /**
   * Handle keyboard
   */
  function handleKeyDown(evt) {
    if (evt.key === 'Escape' && sliceMode) {
      cancelSlice();
    }
  }

  /**
   * Show status message
   */
  function showStatus(message, type) {
    if (onStatusMessage) {
      onStatusMessage(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }

  /**
   * Update slice UI buttons
   */
  function updateSliceUI(isSlicing) {
    const startSliceBtn = document.getElementById('start-slice');
    const cancelSliceBtn = document.getElementById('cancel-slice');
    const startDrawingBtn = document.getElementById('start-drawing');

    if (isSlicing) {
      if (startSliceBtn) startSliceBtn.parentElement.style.display = 'none';
      if (cancelSliceBtn) cancelSliceBtn.parentElement.style.display = 'block';
      if (startDrawingBtn) startDrawingBtn.parentElement.style.display = 'none';
    } else {
      if (startSliceBtn) startSliceBtn.parentElement.style.display = 'block';
      if (cancelSliceBtn) cancelSliceBtn.parentElement.style.display = 'none';
      if (startDrawingBtn) startDrawingBtn.parentElement.style.display = 'block';
    }
  }

  /**
   * Check if slice mode is active
   */
  function isSliceModeActive() {
    return sliceMode;
  }

  /**
   * Debug info
   */
  function getDebugInfo() {
    return {
      sliceMode: sliceMode,
      hasMap: !!map,
      hasLayer: !!sliceLayer,
      startPoint: startPoint,
      sourceType: sourceType
    };
  }

  // Export
  window.SliceTool = {
    init: initSliceTool,
    startSliceMode: startSliceMode,
    cancelSlice: cancelSlice,
    isSliceMode: isSliceModeActive,
    getDebugInfo: getDebugInfo
  };

})(window);
