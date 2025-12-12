//
// OpenLayers map initialization for Ordnance Survey Vector Tiles
// Supports two modes: 'red-line-boundary' and 'habitat-parcels'
//

window.GOVUKPrototypeKit.documentReady(() => {
  // Only initialize if we're on a map page
  const mapContainer = document.getElementById('map');
  if (!mapContainer) {
    return;
  }

  // Read configuration from data attributes
  const mode = mapContainer.dataset.mode || 'red-line-boundary';
  const boundaryUrl = mapContainer.dataset.boundaryUrl || null;

  console.log('=== Map Initialization ===');
  console.log('Mode:', mode);
  console.log('Boundary URL:', boundaryUrl);

  // Define the UK extent in EPSG:3857
  const ukExtent = ol.proj.transformExtent(
    [ -10.76418, 49.528423, 1.9134116, 61.331151 ], 
    'EPSG:4326', 
    'EPSG:3857'
  );

  // England center coordinates
  const englandCenter = ol.proj.fromLonLat([-1.5, 52.5]);

  // Fetch Tile Matrix Set and Style for NGD tiles
  const collectionId = 'ngd-base';
  const tmsUrl = `https://api.os.uk/maps/vector/ngd/ota/v1/tilematrixsets/3857`;
  const styleUrl = '/api/os/tiles/style';

  Promise.all([fetch(tmsUrl), fetch(styleUrl)])
    .then(responses => Promise.all(responses.map(res => res.json())))
    .then(([tms, glStyle]) => {
      console.log('✓ TMS and style loaded');

      // Create tile grid from TMS
      const tileGrid = new ol.tilegrid.TileGrid({
        resolutions: tms.tileMatrices.map(({ cellSize }) => cellSize),
        origin: tms.tileMatrices[0].pointOfOrigin,
        tileSize: [tms.tileMatrices[0].tileHeight, tms.tileMatrices[0].tileWidth]
      });

      // Define the MVT format with octet-stream support
      const formatMvt = new ol.format.MVT();
      formatMvt.supportedMediaTypes.push('application/octet-stream');
      
      console.log('MVT format supported types:', formatMvt.supportedMediaTypes);

      // Create the vector tile layer with VectorTile source
      // The tile URL is proxied through our backend to add the API key securely
      // OGC API Tiles uses {z}/{y}/{x} order (TileMatrix/TileRow/TileCol)
      const vectorTileLayer = new ol.layer.VectorTile({
        source: new ol.source.VectorTile({
          format: formatMvt,
          url: `/api/os/tiles/${collectionId}/{z}/{y}/{x}`,
          projection: 'EPSG:3857',
          tileGrid: tileGrid
        }),
        declutter: true
      });
      
      // Add error handler to see tile loading issues
      vectorTileLayer.getSource().on('tileloaderror', function(event) {
        console.error('Tile load error:', event);
      });

      // Apply style to the vector tile layer with NGD-specific parameters
      // Use updateSource: false to prevent olms from recreating the source
      return olms.applyStyle(
        vectorTileLayer,
        glStyle,
        { source: collectionId, updateSource: false },
        { styleUrl: null },
        tileGrid.getResolutions()
      ).then(() => {
        console.log('✓ Style applied to layer');

        // Initialize the map object
        const map = new ol.Map({
          target: "map",
          layers: [ vectorTileLayer ],
          view: new ol.View({
            projection: 'EPSG:3857',
            extent: ukExtent,
            center: englandCenter,
            zoom: 7,
            minZoom: 6,
            maxZoom: 19,
            resolutions: tileGrid.getResolutions(),
            constrainResolution: true,
            smoothResolutionConstraint: true
          })
        });

        console.log('✓ Map initialized');

        // Set up zoom level display
        setupZoomDisplay(map);

        // Initialize based on mode
        if (mode === 'habitat-parcels' && boundaryUrl) {
          // Fetch boundary and initialize in habitat-parcels mode
          initHabitatParcelsMode(map, boundaryUrl);
        } else {
          // Initialize in red-line-boundary mode
          initRedLineBoundaryMode(map);
        }

        // Set up UI control handlers based on mode
        setupUIControls(mode);
      });
    })
    .catch(error => {
      console.error('❌ Error initializing map:', error);
      // Show error to user
      const mapContainer = document.getElementById('map');
      if (mapContainer) {
        mapContainer.innerHTML = '<div style="padding: 20px; color: red;">Error loading map. Please check console for details.</div>';
      }
    });
});

/**
 * Initialize in red-line-boundary mode
 */
function initRedLineBoundaryMode(map) {
  console.log('Initializing red-line-boundary mode...');
  
  if (window.SnapDrawing && window.SnapDrawing.initWithConfig) {
    window.SnapDrawing.initWithConfig(map, {
      mode: 'red-line-boundary',
      onPolygonComplete: () => {
        console.log('Polygon complete - save button enabled');
      }
    });
  }
}

/**
 * Initialize in habitat-parcels mode
 */
async function initHabitatParcelsMode(map, boundaryUrl) {
  console.log('Initializing habitat-parcels mode...');
  console.log('Fetching boundary from:', boundaryUrl);

  try {
    const response = await fetch(boundaryUrl);
    const boundaryGeoJSON = await response.json();

    if (!boundaryGeoJSON) {
      console.error('No boundary data found. Redirecting to define boundary...');
      showStatus('No boundary defined. Please define a red line boundary first.', 'error');
      setTimeout(() => {
        window.location.href = '/define-red-line-boundary';
      }, 2000);
      return;
    }

    console.log('Boundary loaded:', boundaryGeoJSON);

    if (window.SnapDrawing && window.SnapDrawing.initWithConfig) {
      window.SnapDrawing.initWithConfig(map, {
        mode: 'habitat-parcels',
        boundaryGeoJSON: boundaryGeoJSON,
        onPolygonComplete: () => {
          console.log('Parcel complete');
        },
        onParcelAdded: (parcel, index) => {
          console.log(`Parcel ${index + 1} added`);
          showStatus(`Parcel ${index + 1} added successfully`, 'success');
        },
        onParcelRemoved: (index) => {
          console.log(`Parcel removed`);
          showStatus('Parcel removed', 'info');
        },
        onValidationError: (error) => {
          showStatus(error, 'error');
        }
      });
    }
  } catch (error) {
    console.error('Error fetching boundary:', error);
    showStatus('Error loading boundary. Please try again.', 'error');
  }
}

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

  updateZoomDisplay();
  map.getView().on('change:resolution', updateZoomDisplay);
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
 * Set up UI control button handlers
 */
function setupUIControls(mode) {
  const startButton = document.getElementById('start-drawing');
  const cancelButton = document.getElementById('cancel-drawing');
  const clearButton = document.getElementById('clear-polygon');
  const exportButton = document.getElementById('export-geojson');
  const snapCheckbox = document.getElementById('snap-enabled');
  const saveBoundaryButton = document.getElementById('save-boundary');
  const saveParcelsButton = document.getElementById('save-parcels');

  // Start drawing button
  if (startButton) {
    startButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.startDrawing) {
        window.SnapDrawing.startDrawing();
        startButton.parentElement.style.display = 'none';
        if (cancelButton) cancelButton.parentElement.style.display = 'block';
        showStatus('Drawing mode active - click to place vertices', 'info');
      }
    });
  }

  // Cancel drawing button
  if (cancelButton) {
    cancelButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.cancelDrawing) {
        window.SnapDrawing.cancelDrawing();
        if (startButton) startButton.parentElement.style.display = 'block';
        cancelButton.parentElement.style.display = 'none';
        showStatus('Drawing cancelled', 'info');
      }
    });
  }

  // Clear polygon button (red-line-boundary mode)
  if (clearButton) {
    clearButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.clearPolygon) {
        window.SnapDrawing.clearPolygon();
        showStatus('Polygon cleared - draw a new one', 'info');
      }
    });
  }

  // Export GeoJSON button
  if (exportButton) {
    exportButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SnapDrawing) {
        let geojson;
        
        if (mode === 'habitat-parcels' && window.SnapDrawing.getHabitatParcelsGeoJSON) {
          geojson = window.SnapDrawing.getHabitatParcelsGeoJSON();
          if (geojson.features.length === 0) {
            showStatus('No parcels to export. Draw parcels first.', 'warning');
            return;
          }
        } else if (window.SnapDrawing.getDrawnPolygonGeoJSON) {
          geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
          if (!geojson) {
            showStatus('No polygon to export. Draw a polygon first.', 'warning');
            return;
          }
        }

        if (geojson) {
          // Convert to EPSG:4326 for standard GeoJSON
          const format = new ol.format.GeoJSON();
          let exportData;

          if (geojson.type === 'FeatureCollection') {
            const features = geojson.features.map(f => {
              const feature = format.readFeature(f, {
                dataProjection: 'EPSG:3857',
                featureProjection: 'EPSG:3857'
              });
              return format.writeFeatureObject(feature, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857'
              });
            });
            exportData = { type: 'FeatureCollection', features: features };
          } else {
            const feature = format.readFeature(geojson, {
              dataProjection: 'EPSG:3857',
              featureProjection: 'EPSG:3857'
            });
            exportData = format.writeFeatureObject(feature, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            });
          }

          // Download as file
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
            type: 'application/json' 
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (mode === 'habitat-parcels' ? 'parcels-' : 'boundary-') + Date.now() + '.geojson';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showStatus('GeoJSON exported successfully', 'success');
        }
      }
    });
  }

  // OS Features snapping checkbox
  if (snapCheckbox) {
    snapCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnappingEnabled) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnappingEnabled(enabled);
        showStatus(enabled ? 'OS feature snapping enabled' : 'OS feature snapping disabled', 'info');
      }
    });
  }

  // Boundary vertices snapping checkbox
  const snapBoundaryVerticesCheckbox = document.getElementById('snap-boundary-vertices');
  if (snapBoundaryVerticesCheckbox) {
    snapBoundaryVerticesCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnapToBoundaryVertices) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnapToBoundaryVertices(enabled);
        showStatus(enabled ? 'Boundary corner snapping enabled' : 'Boundary corner snapping disabled', 'info');
      }
    });
  }

  // Boundary edges snapping checkbox
  const snapBoundaryEdgesCheckbox = document.getElementById('snap-boundary-edges');
  if (snapBoundaryEdgesCheckbox) {
    snapBoundaryEdgesCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnapToBoundaryEdges) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnapToBoundaryEdges(enabled);
        showStatus(enabled ? 'Boundary edge snapping enabled' : 'Boundary edge snapping disabled', 'info');
      }
    });
  }

  // Parcel vertices snapping checkbox
  const snapParcelVerticesCheckbox = document.getElementById('snap-parcel-vertices');
  if (snapParcelVerticesCheckbox) {
    snapParcelVerticesCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnapToParcelVertices) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnapToParcelVertices(enabled);
        showStatus(enabled ? 'Parcel corner snapping enabled' : 'Parcel corner snapping disabled', 'info');
      }
    });
  }

  // Parcel edges snapping checkbox
  const snapParcelEdgesCheckbox = document.getElementById('snap-parcel-edges');
  if (snapParcelEdgesCheckbox) {
    snapParcelEdgesCheckbox.addEventListener('change', (e) => {
      if (window.SnapDrawing && window.SnapDrawing.setSnapToParcelEdges) {
        const enabled = e.target.checked;
        window.SnapDrawing.setSnapToParcelEdges(enabled);
        showStatus(enabled ? 'Parcel edge snapping enabled' : 'Parcel edge snapping disabled', 'info');
      }
    });
  }

  // Save boundary button (red-line-boundary mode)
  if (saveBoundaryButton) {
    saveBoundaryButton.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.getDrawnPolygonGeoJSON) {
        const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
        
        if (!geojson) {
          showStatus('No boundary to save. Draw a polygon first.', 'warning');
          return;
        }

        try {
          setControlEnabled(saveBoundaryButton, false);
          const originalText = saveBoundaryButton.textContent;
          saveBoundaryButton.textContent = 'Saving...';

          const response = await fetch('/api/save-red-line-boundary', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(geojson)
          });

          const result = await response.json();

          if (result.success) {
            showStatus('Boundary saved successfully! Redirecting...', 'success');
            setTimeout(() => {
              window.location.href = result.redirect;
            }, 1000);
          } else {
            throw new Error('Save failed');
          }
        } catch (error) {
          console.error('Error saving boundary:', error);
          showStatus('Error saving boundary. Please try again.', 'error');
          setControlEnabled(saveBoundaryButton, true);
          saveBoundaryButton.textContent = 'Save Boundary';
        }
      }
    });
  }

  // Save parcels button (habitat-parcels mode)
  if (saveParcelsButton) {
    saveParcelsButton.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.getHabitatParcelsGeoJSON) {
        const geojson = window.SnapDrawing.getHabitatParcelsGeoJSON();
        
        if (geojson.features.length === 0) {
          showStatus('No parcels to save. Draw at least one parcel.', 'warning');
          return;
        }

        // Validate all parcels before saving
        if (window.SnapDrawing.validateAllParcels) {
          const validation = window.SnapDrawing.validateAllParcels();
          if (!validation.valid) {
            const errorMsg = 'Cannot save parcels:\n• ' + validation.errors.join('\n• ');
            showStatus(errorMsg, 'error');
            console.error('Validation errors:', validation.errors);
            return;
          }
        }

        try {
          setControlEnabled(saveParcelsButton, false);
          const originalText = saveParcelsButton.textContent;
          saveParcelsButton.textContent = 'Saving...';

          const response = await fetch('/api/save-habitat-parcels', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(geojson)
          });

          const result = await response.json();

          if (result.success) {
            showStatus('Parcels saved successfully! Redirecting...', 'success');
            setTimeout(() => {
              window.location.href = result.redirect;
            }, 1000);
          } else {
            throw new Error('Save failed');
          }
        } catch (error) {
          console.error('Error saving parcels:', error);
          showStatus('Error saving parcels. Please try again.', 'error');
          setControlEnabled(saveParcelsButton, true);
          saveParcelsButton.textContent = 'Save Parcels';
        }
      }
    });
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const statusMessage = document.getElementById('status-message');
  const statusText = document.getElementById('status-text');
  const statusTitle = document.getElementById('status-title');
  
  if (!statusMessage || !statusText || !statusTitle) {
    console.log(`[${type}] ${message}`);
    return;
  }

  statusText.textContent = message;

  let title = 'Information';
  let ariaLive = 'polite';
  
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
  
  statusMessage.style.display = 'block';
  
  // Auto-hide after 5 seconds (longer for errors)
  const hideDelay = type === 'error' ? 8000 : 5000;
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, hideDelay);
}
