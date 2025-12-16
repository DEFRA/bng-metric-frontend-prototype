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

  // Initialize Fill tool for red-line-boundary mode
  if (window.FillTool && window.FillTool.init) {
    window.FillTool.init(map, {
      onSelectionChange: (info) => {
        console.log(`Fill selection changed: ${info.count} polygons, ${info.totalAreaHectares.toFixed(2)} ha`);
      },
      onConfirm: (result) => {
        console.log('Fill confirmed:', result);
        showStatus(`Boundary created: ${result.areaHectares.toFixed(2)} hectares`, 'success');
        // Enable save button and show area display
        const saveButton = document.getElementById('save-boundary');
        if (saveButton) {
          saveButton.classList.remove('disabled');
        }
        const areaDisplay = document.getElementById('area-display');
        const areaValue = document.getElementById('area-value');
        const areaAcres = document.getElementById('area-acres');
        if (areaDisplay && areaValue && areaAcres) {
          areaValue.textContent = result.areaHectares.toFixed(2);
          areaAcres.textContent = (result.area / 4046.86).toFixed(2);
          areaDisplay.style.display = 'block';
        }
      },
      onError: (message, type) => {
        showStatus(message, type || 'warning');
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
          // Refresh form if HabitatAttribution is initialized
          if (window.HabitatAttribution && window.HabitatAttribution.renderForm) {
            window.HabitatAttribution.renderForm();
          }
        },
        onParcelRemoved: (index) => {
          console.log(`Parcel removed`);
          showStatus('Parcel removed', 'info');
          // Refresh form if HabitatAttribution is initialized
          if (window.HabitatAttribution && window.HabitatAttribution.renderForm) {
            window.HabitatAttribution.renderForm();
          }
        },
        onParcelSelected: (index) => {
          console.log(`Parcel selected: ${index}`);
          // Sync selection to HabitatAttribution module
          if (window.HabitatAttribution) {
            if (index >= 0) {
              window.HabitatAttribution.selectParcel(index);
            } else {
              window.HabitatAttribution.deselectParcel();
            }
          }
        },
        onValidationError: (error) => {
          showStatus(error, 'error');
        }
      });
    }

    // Initialize HabitatAttribution module for baseline habitat data entry
    if (window.HabitatAttribution && window.HabitatAttribution.init) {
      window.HabitatAttribution.init({
        onSelectionChange: (index) => {
          console.log(`HabitatAttribution selection changed to: ${index}`);
          // Sync selection back to SnapDrawing
          if (window.SnapDrawing) {
            if (index >= 0) {
              window.SnapDrawing.selectParcel(index);
            } else {
              window.SnapDrawing.deselectParcel();
            }
          }
        },
        onValidationChange: (index, valid, errors) => {
          console.log(`Parcel ${index + 1} validation: ${valid ? 'valid' : 'invalid'}`, errors);
          // Update save button state based on all parcels validation
          updateSaveButtonState();
        }
      });

      // Set up deselect button handler
      const deselectBtn = document.getElementById('deselect-parcel-btn');
      if (deselectBtn) {
        deselectBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.HabitatAttribution && window.HabitatAttribution.deselectParcel) {
            window.HabitatAttribution.deselectParcel();
          }
          if (window.SnapDrawing && window.SnapDrawing.deselectParcel) {
            window.SnapDrawing.deselectParcel();
          }
        });
      }
    }

    // Initialize slice tool for habitat-parcels mode
    if (window.SliceTool && window.SliceTool.init) {
      window.SliceTool.init(map, {
        onSliceComplete: () => {
          console.log('Slice complete');
          // Refresh form after slice
          if (window.HabitatAttribution && window.HabitatAttribution.renderForm) {
            window.HabitatAttribution.renderForm();
          }
        },
        onSliceCancel: () => {
          console.log('Slice cancelled');
        },
        onStatusMessage: (message, type) => {
          showStatus(message, type);
        }
      });
    }

    // Initialize fill tool for habitat-parcels mode
    if (window.FillTool && window.FillTool.init) {
      window.FillTool.init(map, {
        mode: 'habitat-parcels',
        onParcelAdded: (parcel) => {
          console.log('Fill parcel added:', parcel);
          // Refresh form after fill
          if (window.HabitatAttribution && window.HabitatAttribution.renderForm) {
            window.HabitatAttribution.renderForm();
          }
        },
        onError: (message, type) => {
          showStatus(message, type || 'warning');
        }
      });
    }
  } catch (error) {
    console.error('Error fetching boundary:', error);
    showStatus('Error loading boundary. Please try again.', 'error');
  }
}

/**
 * Update the save button state based on all parcels validation
 */
function updateSaveButtonState() {
  const saveParcelsButton = document.getElementById('save-parcels');
  if (!saveParcelsButton) return;

  // Check if we have any parcels
  let parcelCount = 0;
  if (window.SnapDrawing && window.SnapDrawing.getParcelCount) {
    parcelCount = window.SnapDrawing.getParcelCount();
  }

  if (parcelCount === 0) {
    setControlEnabled(saveParcelsButton, false);
    return;
  }

  // Check if all parcels are valid
  let allValid = true;
  if (window.HabitatAttribution && window.HabitatAttribution.validateAllParcels) {
    const validation = window.HabitatAttribution.validateAllParcels();
    allValid = validation.valid;
  }

  setControlEnabled(saveParcelsButton, allValid);
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
      // Cancel fill mode if active
      if (window.FillTool && window.FillTool.isActive && window.FillTool.isActive()) {
        window.FillTool.cancelFillMode();
      }
      if (window.SnapDrawing && window.SnapDrawing.startDrawing) {
        window.SnapDrawing.startDrawing();
        startButton.parentElement.style.display = 'none';
        const startFillBtn = document.getElementById('start-fill');
        if (startFillBtn) startFillBtn.parentElement.style.display = 'none';
        const startFillParcelBtn = document.getElementById('start-fill-parcel');
        if (startFillParcelBtn) startFillParcelBtn.parentElement.style.display = 'none';
        const startSliceBtn = document.getElementById('start-slice');
        if (startSliceBtn) startSliceBtn.parentElement.style.display = 'none';
        if (cancelButton) cancelButton.parentElement.style.display = 'block';
        showStatus('Drawing mode active - click to place vertices', 'info');
      }
    });
  }

  // Fill tool buttons
  const startFillButton = document.getElementById('start-fill');
  const cancelFillButton = document.getElementById('cancel-fill');
  const confirmFillButton = document.getElementById('confirm-fill');

  if (startFillButton) {
    startFillButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.FillTool && window.FillTool.startFillMode) {
        window.FillTool.startFillMode();
        showStatus('Fill mode active - click on polygons to select them', 'info');
      }
    });
  }

  if (cancelFillButton) {
    cancelFillButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.FillTool && window.FillTool.cancelFillMode) {
        window.FillTool.cancelFillMode();
        showStatus('Fill mode cancelled', 'info');
      }
    });
  }

  if (confirmFillButton) {
    confirmFillButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.FillTool && window.FillTool.confirmSelection) {
        const success = window.FillTool.confirmSelection();
        if (!success) {
          // Error message will be shown by the FillTool
        }
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
        const startFillBtn = document.getElementById('start-fill');
        if (startFillBtn) startFillBtn.parentElement.style.display = 'block';
        const startFillParcelBtn = document.getElementById('start-fill-parcel');
        if (startFillParcelBtn) startFillParcelBtn.parentElement.style.display = 'block';
        const startSliceBtn = document.getElementById('start-slice');
        if (startSliceBtn) startSliceBtn.parentElement.style.display = 'block';
        cancelButton.parentElement.style.display = 'none';
        showStatus('Drawing cancelled', 'info');
      }
    });
  }

  // Slice tool buttons (habitat-parcels mode)
  const startSliceButton = document.getElementById('start-slice');
  const cancelSliceButton = document.getElementById('cancel-slice');

  if (startSliceButton) {
    startSliceButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SliceTool && window.SliceTool.startSliceMode) {
        window.SliceTool.startSliceMode();
      }
    });
  }

  if (cancelSliceButton) {
    cancelSliceButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SliceTool && window.SliceTool.cancelSlice) {
        window.SliceTool.cancelSlice();
      }
    });
  }

  // Fill parcel buttons (habitat-parcels mode)
  const startFillParcelButton = document.getElementById('start-fill-parcel');
  const finishFillParcelButton = document.getElementById('finish-fill-parcel');

  if (startFillParcelButton) {
    startFillParcelButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.FillTool && window.FillTool.startFillModeForParcels) {
        window.FillTool.startFillModeForParcels();
        showStatus('Fill mode active - click on OS polygons within the boundary to add as parcels', 'info');
      }
    });
  }

  if (finishFillParcelButton) {
    finishFillParcelButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.FillTool && window.FillTool.cancelFillMode) {
        window.FillTool.cancelFillMode();
        showStatus('Fill mode finished', 'info');
      }
    });
  }

  // Clear polygon button (red-line-boundary mode)
  if (clearButton) {
    clearButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.SnapDrawing && window.SnapDrawing.clearPolygon) {
        window.SnapDrawing.clearPolygon();
        // Show both drawing options again
        if (startButton) startButton.parentElement.style.display = 'block';
        const startFillBtn = document.getElementById('start-fill');
        if (startFillBtn) startFillBtn.parentElement.style.display = 'block';
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
