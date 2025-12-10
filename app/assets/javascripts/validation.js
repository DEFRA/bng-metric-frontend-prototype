//
// Polygon validation module for habitat parcels
// Validates parcels against boundary and checks for overlaps
//

(function(window) {
  'use strict';

  /**
   * Validate a parcel polygon against boundary and existing parcels
   * @param {ol.geom.Polygon} parcelGeom - The polygon to validate
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon (can be null)
   * @param {Array} habitatParcels - Array of existing parcel objects
   * @param {number} skipIndex - Index of parcel to skip (when validating itself)
   * @returns {Object} { valid: boolean, error: string|null }
   */
  function validateParcel(parcelGeom, boundaryPolygon, habitatParcels, skipIndex = -1) {
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
   * @param {Array} habitatParcels - Array of parcel objects
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon (can be null)
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateAllParcels(habitatParcels, boundaryPolygon) {
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
   * @param {ol.geom.Polygon} outerPolygon - The boundary polygon
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
   * @param {Array} point - [x, y] coordinate
   * @param {ol.geom.Polygon} polygon - The polygon to check
   * @returns {boolean}
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
   * @param {ol.geom.Polygon} polygon1 
   * @param {ol.geom.Polygon} polygon2 
   * @returns {boolean}
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
   * @param {Array} a1 - First point of segment A
   * @param {Array} a2 - Second point of segment A
   * @param {Array} b1 - First point of segment B
   * @param {Array} b2 - Second point of segment B
   * @returns {boolean}
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
   * Helper for line segment intersection - calculates cross product direction
   * @param {Array} p1 - First point [x, y]
   * @param {Array} p2 - Second point [x, y]
   * @param {Array} p3 - Third point [x, y]
   * @returns {number}
   */
  function direction(p1, p2, p3) {
    return (p3[0] - p1[0]) * (p2[1] - p1[1]) - (p2[0] - p1[0]) * (p3[1] - p1[1]);
  }

  // Export public API
  window.ParcelValidation = {
    validateParcel: validateParcel,
    validateAllParcels: validateAllParcels,
    isPolygonWithinBoundary: isPolygonWithinBoundary,
    doPolygonsOverlap: doPolygonsOverlap,
    isPointInsidePolygon: isPointInsidePolygon,
    doPolygonEdgesIntersect: doPolygonEdgesIntersect,
    doLineSegmentsIntersect: doLineSegmentsIntersect
  };

})(window);
