//
// Example usage of the SnapDrawing API
// This file demonstrates how to programmatically interact with the polygon drawing system
//

/**
 * Example 1: Access the current polygon coordinates at any time
 */
function getCurrentCoordinates() {
  const coords = window.SnapDrawing.getCurrentPolygonCoords();
  console.log('Current polygon coordinates (EPSG:3857):', coords);
  return coords;
}

/**
 * Example 2: Export the drawn polygon as GeoJSON
 */
function exportPolygon() {
  const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
  
  if (geojson) {
    console.log('Polygon GeoJSON (EPSG:3857):', geojson);
    
    // You can now POST this to your API
    // Example:
    // fetch('/api/save-polygon', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(geojson)
    // });
    
    return geojson;
  } else {
    console.warn('No polygon drawn yet');
    return null;
  }
}

/**
 * Example 3: Cancel the current drawing
 */
function cancelCurrentDrawing() {
  window.SnapDrawing.cancelDrawing();
  console.log('Drawing cancelled');
}

/**
 * Example 4: Convert to EPSG:4326 for standard lat/lng coordinates
 */
function exportAsLatLng() {
  const geojson3857 = window.SnapDrawing.getDrawnPolygonGeoJSON();
  
  if (!geojson3857) {
    console.warn('No polygon to convert');
    return null;
  }

  // Use OpenLayers to convert projections
  const format = new ol.format.GeoJSON();
  const feature = format.readFeature(geojson3857, {
    dataProjection: 'EPSG:3857',
    featureProjection: 'EPSG:3857'
  });
  
  const geojson4326 = format.writeFeatureObject(feature, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });

  console.log('Polygon in EPSG:4326 (lat/lng):', geojson4326);
  return geojson4326;
}

/**
 * Example 5: Calculate polygon area
 */
function calculatePolygonArea() {
  const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
  
  if (!geojson) {
    console.warn('No polygon to measure');
    return null;
  }

  const format = new ol.format.GeoJSON();
  const feature = format.readFeature(geojson, {
    dataProjection: 'EPSG:3857',
    featureProjection: 'EPSG:3857'
  });
  
  const geometry = feature.getGeometry();
  const areaSqMeters = geometry.getArea();
  const areaHectares = areaSqMeters / 10000;
  
  console.log('Polygon area:', {
    squareMeters: areaSqMeters.toFixed(2),
    hectares: areaHectares.toFixed(4),
    acres: (areaHectares * 2.47105).toFixed(4)
  });
  
  return areaSqMeters;
}

// Export functions for use in other scripts
window.SnapDrawingExamples = {
  getCurrentCoordinates,
  exportPolygon,
  cancelCurrentDrawing,
  exportAsLatLng,
  calculatePolygonArea
};

