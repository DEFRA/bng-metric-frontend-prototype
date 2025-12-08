//
// OpenLayers map initialization for Ordnance Survey Vector Tiles
//

window.GOVUKPrototypeKit.documentReady(() => {
  // Only initialize if we're on the map page
  const mapContainer = document.getElementById('map');
  if (!mapContainer) {
    return;
  }

  // Define the vector tile layer
  const vectorTileLayer = new ol.layer.VectorTile({
    declutter: true
  });

  // Apply a style function to the vector tile layer
  // Using backend proxy endpoint to keep API key secure
  olms.applyStyle(
    vectorTileLayer,
    '/api/os/tiles/style'
  );

  // Define the UK extent in EPSG:3857 (for constraining the view)
  const ukExtent = ol.proj.transformExtent(
    [ -10.76418, 49.528423, 1.9134116, 61.331151 ], 
    'EPSG:4326', 
    'EPSG:3857'
  );

  // England center coordinates (approximately Leicestershire)
  const englandCenter = ol.proj.fromLonLat([-1.5, 52.5]);

  // Initialize the map object
  const map = new ol.Map({
    target: "map",
    layers: [ vectorTileLayer ],
    view: new ol.View({
      projection: 'EPSG:3857',
      extent: ukExtent,
      center: englandCenter,
      zoom: 7,  // Zoom level that shows most of England
      minZoom: 6,
      maxZoom: 16,  // Limit to zoom level 16 to prevent blank tiles
      constrainResolution: true,  // Ensure resolution stays within available tile levels
      smoothResolutionConstraint: true  // Smooth zooming experience
    })
  });

  // Set up zoom level display
  setupZoomDisplay(map);

  // Initialize snapping system if available
  if (window.SnapDrawing && window.SnapDrawing.initSnapping) {
    window.SnapDrawing.initSnapping(map);
  }

  // Set up UI control handlers
  setupUIControls();
});

/**
 * Set up zoom level display
 */
function setupZoomDisplay(map) {
  const zoomDisplay = document.getElementById('zoom-display');
  const snapStatus = document.getElementById('snap-status');
  const MIN_ZOOM_FOR_SNAP = 14;

  if (!zoomDisplay) {
    return;
  }

  function updateZoomDisplay() {
    const zoom = map.getView().getZoom();
    const roundedZoom = Math.round(zoom * 10) / 10;
    
    zoomDisplay.textContent = `Zoom: ${roundedZoom}`;
    
    if (zoom >= MIN_ZOOM_FOR_SNAP) {
      zoomDisplay.className = 'govuk-tag govuk-tag--green';
      if (snapStatus) {
        snapStatus.textContent = 'Snapping enabled';
        snapStatus.style.color = '#00703c';
        snapStatus.style.fontWeight = 'bold';
      }
    } else {
      zoomDisplay.className = 'govuk-tag';
      if (snapStatus) {
        snapStatus.textContent = `Snapping disabled (zoom to level ${MIN_ZOOM_FOR_SNAP}+)`;
        snapStatus.style.color = '#505a5f';
        snapStatus.style.fontWeight = 'normal';
      }
    }
  }

  // Initial update
  updateZoomDisplay();

  // Update on zoom change
  map.getView().on('change:resolution', updateZoomDisplay);
}

/**
 * Set up UI control button handlers
 */
function setupUIControls() {
  const startButton = document.getElementById('start-drawing');
  const cancelButton = document.getElementById('cancel-drawing');
  const clearButton = document.getElementById('clear-polygon');
  const exportButton = document.getElementById('export-geojson');
  const snapCheckbox = document.getElementById('snap-enabled');
  const statusMessage = document.getElementById('status-message');
  const statusText = document.getElementById('status-text');

  if (!startButton || !cancelButton || !clearButton || !exportButton) {
    return;
  }

  // Start drawing button
  startButton.addEventListener('click', () => {
    if (window.SnapDrawing && window.SnapDrawing.startDrawing) {
      window.SnapDrawing.startDrawing();
      startButton.style.display = 'none';
      cancelButton.style.display = 'inline-block';
      showStatus('Drawing mode active - click to place vertices', 'info');
    }
  });

  // Cancel drawing button
  cancelButton.addEventListener('click', () => {
    if (window.SnapDrawing && window.SnapDrawing.cancelDrawing) {
      window.SnapDrawing.cancelDrawing();
      startButton.style.display = 'inline-block';
      cancelButton.style.display = 'none';
      showStatus('Drawing cancelled', 'info');
    }
  });

  // Clear polygon button
  clearButton.addEventListener('click', () => {
    if (window.SnapDrawing && window.SnapDrawing.clearPolygon) {
      window.SnapDrawing.clearPolygon();
      showStatus('Polygon cleared - draw a new one', 'info');
    }
  });

  // Export GeoJSON button
  exportButton.addEventListener('click', () => {
    if (window.SnapDrawing && window.SnapDrawing.getDrawnPolygonGeoJSON) {
      const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
      
      if (geojson) {
        // Convert to EPSG:4326 for standard GeoJSON
        const format = new ol.format.GeoJSON();
        const feature = format.readFeature(geojson, {
          dataProjection: 'EPSG:3857',
          featureProjection: 'EPSG:3857'
        });
        
        const geojson4326 = format.writeFeatureObject(feature, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857'
        });

        // Download as file
        const blob = new Blob([JSON.stringify(geojson4326, null, 2)], { 
          type: 'application/json' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'polygon-' + Date.now() + '.geojson';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('GeoJSON exported successfully', 'success');
        
        // Also log to console for debugging
        console.log('Exported GeoJSON (EPSG:4326):', geojson4326);
      } else {
        showStatus('No polygon to export. Draw a polygon first.', 'warning');
      }
    }
  });

  // Snapping checkbox
  if (snapCheckbox) {
    snapCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnappingEnabled) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnappingEnabled(enabled);
        showStatus(enabled ? 'Snapping enabled' : 'Snapping disabled', 'info');
      }
    });
  }

  function showStatus(message, type) {
    const statusTitle = document.getElementById('status-title');
    
    if (!statusMessage || !statusText || !statusTitle) {
      return;
    }

    // Set message content
    statusText.textContent = message;

    // Update title and styling based on type
    let title = 'Information';
    let ariaLive = 'polite';
    
    // Remove any existing type classes
    statusMessage.classList.remove('govuk-notification-banner--success');
    
    if (type === 'success') {
      title = 'Success';
      statusMessage.classList.add('govuk-notification-banner--success');
      ariaLive = 'polite';
    } else if (type === 'warning') {
      title = 'Important';
      ariaLive = 'assertive';
    } else if (type === 'error') {
      title = 'Error';
      ariaLive = 'assertive';
    }
    
    statusTitle.textContent = title;
    statusMessage.setAttribute('aria-live', ariaLive);
    statusMessage.setAttribute('aria-atomic', 'true');
    
    // Show notification
    statusMessage.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 5000);
  }
}
