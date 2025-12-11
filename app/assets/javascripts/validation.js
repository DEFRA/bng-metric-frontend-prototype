//
// Polygon validation module for habitat parcels
// Validates parcels against boundary and checks for overlaps
//

(function(window) {
  'use strict';

  // Tolerance for floating-point comparisons (1mm in map units)
  // Web Mercator (EPSG:3857) uses meters, so 0.001 = 1 millimeter
  const EPSILON = 0.001;

  /**
   * Validate a parcel polygon against boundary and existing parcels
   * @param {ol.geom.Polygon} parcelGeom - The polygon to validate
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon (can be null)
   * @param {Array} habitatParcels - Array of existing parcel objects
   * @param {number} skipIndex - Index of parcel to skip (when validating itself)
   * @returns {Object} { valid: boolean, error: string|null, correctedGeom: ol.geom.Polygon }
   */
  function validateParcel(parcelGeom, boundaryPolygon, habitatParcels, skipIndex = -1) {
    // Correct geometry to snap to boundary if needed
    const correctedGeom = boundaryPolygon ? correctGeometryToBoundary(parcelGeom, boundaryPolygon) : parcelGeom;

    // Check if parcel is within boundary
    if (boundaryPolygon) {
      if (!isPolygonWithinBoundary(correctedGeom, boundaryPolygon)) {
        return {
          valid: false,
          error: 'The parcel must be completely within the red line boundary.',
          correctedGeom: correctedGeom
        };
      }
    }

    // Check for overlap with existing parcels (skip self if editing)
    for (let i = 0; i < habitatParcels.length; i++) {
      if (i === skipIndex) continue;  // Skip self
      
      const existingParcel = habitatParcels[i];
      if (doPolygonsOverlap(correctedGeom, existingParcel.feature.getGeometry())) {
        return {
          valid: false,
          error: `The parcel overlaps with parcel ${i + 1}. Parcels must not overlap.`,
          correctedGeom: correctedGeom
        };
      }
    }

    return { valid: true, error: null, correctedGeom: correctedGeom };
  }

  /**
   * Validate all habitat parcels before saving
   * @param {Array} habitatParcels - Array of parcel objects
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon (can be null)
   * @returns {Object} { valid: boolean, errors: string[], correctedParcels: Array }
   */
  function validateAllParcels(habitatParcels, boundaryPolygon) {
    const errors = [];
    const correctedParcels = [];

    // First pass: correct all geometries
    for (let i = 0; i < habitatParcels.length; i++) {
      const parcel = habitatParcels[i];
      const parcelGeom = parcel.feature.getGeometry();
      const correctedGeom = boundaryPolygon ? correctGeometryToBoundary(parcelGeom, boundaryPolygon) : parcelGeom;
      correctedParcels.push(correctedGeom);
    }

    // Second pass: validate corrected geometries
    for (let i = 0; i < correctedParcels.length; i++) {
      const correctedGeom = correctedParcels[i];

      // Check if parcel is within boundary
      if (boundaryPolygon && !isPolygonWithinBoundary(correctedGeom, boundaryPolygon)) {
        errors.push(`Parcel ${i + 1} extends outside the red line boundary.`);
      }

      // Check for overlap with other parcels
      for (let j = i + 1; j < correctedParcels.length; j++) {
        const otherCorrectedGeom = correctedParcels[j];
        if (doPolygonsOverlap(correctedGeom, otherCorrectedGeom)) {
          errors.push(`Parcel ${i + 1} overlaps with parcel ${j + 1}.`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      correctedParcels: correctedParcels
    };
  }

  /**
   * Correct parcel geometry by snapping vertices to boundary coordinates
   * @param {ol.geom.Polygon} parcelGeom - The parcel polygon to correct
   * @param {ol.geom.Polygon} boundaryPolygon - The boundary polygon
   * @returns {ol.geom.Polygon} Corrected polygon geometry
   */
  function correctGeometryToBoundary(parcelGeom, boundaryPolygon) {
    if (!boundaryPolygon) {
      return parcelGeom;
    }

    const parcelCoords = parcelGeom.getCoordinates()[0];
    const boundaryCoords = boundaryPolygon.getCoordinates()[0];
    const correctedCoords = [];
    const snapTolerance = EPSILON * 10; // 1cm snap tolerance

    for (let i = 0; i < parcelCoords.length; i++) {
      const coord = parcelCoords[i];
      let snapped = false;
      let snappedCoord = coord;

      // First, try to snap to boundary vertices (exact match preferred)
      for (let j = 0; j < boundaryCoords.length - 1; j++) {
        const boundaryVertex = boundaryCoords[j];
        const dx = coord[0] - boundaryVertex[0];
        const dy = coord[1] - boundaryVertex[1];
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < snapTolerance) {
          snappedCoord = boundaryVertex.slice(); // Use exact boundary coordinate
          snapped = true;
          break;
        }
      }

      // If not snapped to a vertex, try to snap to boundary edges
      if (!snapped) {
        for (let j = 0; j < boundaryCoords.length - 1; j++) {
          const edgeStart = boundaryCoords[j];
          const edgeEnd = boundaryCoords[j + 1];
          
          // Find closest point on edge
          const closestPoint = getClosestPointOnSegment(coord, edgeStart, edgeEnd);
          const dx = coord[0] - closestPoint[0];
          const dy = coord[1] - closestPoint[1];
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < snapTolerance) {
            snappedCoord = closestPoint;
            snapped = true;
            break;
          }
        }
      }

      correctedCoords.push(snappedCoord);
    }

    // Create new polygon with corrected coordinates
    return new ol.geom.Polygon([correctedCoords]);
  }

  /**
   * Get the closest point on a line segment to a given point
   * @param {Array} point - [x, y] coordinate
   * @param {Array} segStart - Start point of segment [x, y]
   * @param {Array} segEnd - End point of segment [x, y]
   * @returns {Array} Closest point [x, y]
   */
  function getClosestPointOnSegment(point, segStart, segEnd) {
    const x = point[0], y = point[1];
    const x1 = segStart[0], y1 = segStart[1];
    const x2 = segEnd[0], y2 = segEnd[1];

    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) {
      return segStart.slice();
    }

    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    
    return [x1 + t * dx, y1 + t * dy];
  }

  /**
   * Check if a point is inside or on the boundary of a polygon (with tolerance)
   * @param {Array} point - [x, y] coordinate
   * @param {ol.geom.Polygon} polygon - The polygon to check
   * @returns {boolean}
   */
  function isPointInsideOrOnBoundary(point, polygon) {
    // Check if point is on the boundary (within tolerance)
    if (isPointOnPolygonBoundary(point, polygon)) {
      return true;
    }

    // Check if point is strictly inside using ray casting
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
   * Check if a polygon is completely within another polygon (boundary)
   * @param {ol.geom.Polygon} innerPolygon - The polygon to check
   * @param {ol.geom.Polygon} outerPolygon - The boundary polygon
   * @returns {boolean}
   */
  function isPolygonWithinBoundary(innerPolygon, outerPolygon) {
    // Get all coordinates of the inner polygon
    const innerCoords = innerPolygon.getCoordinates()[0];
    
    // Check that every vertex of the inner polygon is inside or on the boundary
    for (let i = 0; i < innerCoords.length - 1; i++) {
      const coord = innerCoords[i];
      if (!isPointInsideOrOnBoundary(coord, outerPolygon)) {
        return false;
      }
    }

    // Check edge midpoints to ensure edges don't extend outside
    for (let i = 0; i < innerCoords.length - 1; i++) {
      const midpoint = [
        (innerCoords[i][0] + innerCoords[i + 1][0]) / 2,
        (innerCoords[i][1] + innerCoords[i + 1][1]) / 2
      ];
      if (!isPointInsideOrOnBoundary(midpoint, outerPolygon)) {
        return false;
      }
    }

    // Extent check with tolerance buffer
    const innerExtent = innerPolygon.getExtent();
    const outerExtent = outerPolygon.getExtent();
    const buffer = EPSILON * 10; // 1cm buffer for tolerance
    
    // Check if inner extent is within outer extent (with tolerance)
    if (innerExtent[0] < outerExtent[0] - buffer ||
        innerExtent[1] < outerExtent[1] - buffer ||
        innerExtent[2] > outerExtent[2] + buffer ||
        innerExtent[3] > outerExtent[3] + buffer) {
      return false;
    }

    return true;
  }

  /**
   * Check if two polygons have true interior overlap (not just touching boundaries)
   * @param {ol.geom.Polygon} polygon1 
   * @param {ol.geom.Polygon} polygon2 
   * @returns {boolean} True only if polygons have overlapping interiors
   */
  function doPolygonsOverlap(polygon1, polygon2) {
    // Quick extent check first
    const extent1 = polygon1.getExtent();
    const extent2 = polygon2.getExtent();
    
    if (!ol.extent.intersects(extent1, extent2)) {
      return false;
    }

    const coords1 = polygon1.getCoordinates()[0];
    const coords2 = polygon2.getCoordinates()[0];

    // Check if any vertex of polygon1 is strictly inside polygon2 (not on boundary)
    for (let i = 0; i < coords1.length - 1; i++) {
      if (isPointInsidePolygon(coords1[i], polygon2)) {
        return true;
      }
    }

    // Check if any vertex of polygon2 is strictly inside polygon1 (not on boundary)
    for (let i = 0; i < coords2.length - 1; i++) {
      if (isPointInsidePolygon(coords2[i], polygon1)) {
        return true;
      }
    }

    // Check for proper edge intersections (not collinear overlaps or touching)
    if (doPolygonEdgesIntersect(polygon1, polygon2)) {
      return true;
    }

    // Additional check: test edge midpoints to catch cases where edges cross
    // without any vertices being inside the other polygon
    for (let i = 0; i < coords1.length - 1; i++) {
      const midpoint = [
        (coords1[i][0] + coords1[i + 1][0]) / 2,
        (coords1[i][1] + coords1[i + 1][1]) / 2
      ];
      if (isPointInsidePolygon(midpoint, polygon2)) {
        return true;
      }
    }

    for (let i = 0; i < coords2.length - 1; i++) {
      const midpoint = [
        (coords2[i][0] + coords2[i + 1][0]) / 2,
        (coords2[i][1] + coords2[i + 1][1]) / 2
      ];
      if (isPointInsidePolygon(midpoint, polygon1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a point lies on a line segment (with tolerance)
   * @param {Array} point - [x, y] coordinate
   * @param {Array} segStart - Start point of segment [x, y]
   * @param {Array} segEnd - End point of segment [x, y]
   * @returns {boolean}
   */
  function isPointOnLineSegment(point, segStart, segEnd) {
    const x = point[0], y = point[1];
    const x1 = segStart[0], y1 = segStart[1];
    const x2 = segEnd[0], y2 = segEnd[1];

    // Check if point is within bounding box of segment
    const minX = Math.min(x1, x2) - EPSILON;
    const maxX = Math.max(x1, x2) + EPSILON;
    const minY = Math.min(y1, y2) - EPSILON;
    const maxY = Math.max(y1, y2) + EPSILON;

    if (x < minX || x > maxX || y < minY || y > maxY) {
      return false;
    }

    // Calculate cross product to check collinearity
    const crossProduct = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
    
    return Math.abs(crossProduct) < EPSILON;
  }

  /**
   * Check if a point lies on the boundary of a polygon
   * @param {Array} point - [x, y] coordinate
   * @param {ol.geom.Polygon} polygon - The polygon to check
   * @returns {boolean}
   */
  function isPointOnPolygonBoundary(point, polygon) {
    const coords = polygon.getCoordinates()[0];
    
    for (let i = 0; i < coords.length - 1; i++) {
      const segStart = coords[i];
      const segEnd = coords[i + 1];
      
      if (isPointOnLineSegment(point, segStart, segEnd)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if a point is strictly inside a polygon (not on the boundary)
   * @param {Array} point - [x, y] coordinate
   * @param {ol.geom.Polygon} polygon - The polygon to check
   * @returns {boolean}
   */
  function isPointInsidePolygon(point, polygon) {
    // First check if point is on the boundary - if so, it's not strictly inside
    if (isPointOnPolygonBoundary(point, polygon)) {
      return false;
    }

    // Use ray casting algorithm for interior check
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
   * Check if two line segments properly intersect (excluding shared edges and endpoint touching)
   * @param {Array} a1 - First point of segment A
   * @param {Array} a2 - Second point of segment A
   * @param {Array} b1 - First point of segment B
   * @param {Array} b2 - Second point of segment B
   * @returns {boolean} True only if segments cross (not touch or overlap)
   */
  function doLineSegmentsIntersect(a1, a2, b1, b2) {
    const d1 = direction(b1, b2, a1);
    const d2 = direction(b1, b2, a2);
    const d3 = direction(a1, a2, b1);
    const d4 = direction(a1, a2, b2);

    // Check if segments are collinear (or nearly collinear)
    const allCollinear = Math.abs(d1) < EPSILON && Math.abs(d2) < EPSILON && 
                        Math.abs(d3) < EPSILON && Math.abs(d4) < EPSILON;
    
    if (allCollinear) {
      // Segments are collinear - check if they overlap
      // This could be a shared edge, which we want to allow
      return false;
    }

    // Check if any endpoints are the same (segments touch at endpoint)
    const endpointsMatch = 
      (Math.abs(a1[0] - b1[0]) < EPSILON && Math.abs(a1[1] - b1[1]) < EPSILON) ||
      (Math.abs(a1[0] - b2[0]) < EPSILON && Math.abs(a1[1] - b2[1]) < EPSILON) ||
      (Math.abs(a2[0] - b1[0]) < EPSILON && Math.abs(a2[1] - b1[1]) < EPSILON) ||
      (Math.abs(a2[0] - b2[0]) < EPSILON && Math.abs(a2[1] - b2[1]) < EPSILON);
    
    if (endpointsMatch) {
      // Segments share an endpoint - this is allowed (touching boundaries)
      return false;
    }

    // Check for proper intersection (segments cross each other)
    if (((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
        ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))) {
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
    correctGeometryToBoundary: correctGeometryToBoundary,
    isPolygonWithinBoundary: isPolygonWithinBoundary,
    isPointInsideOrOnBoundary: isPointInsideOrOnBoundary,
    doPolygonsOverlap: doPolygonsOverlap,
    isPointInsidePolygon: isPointInsidePolygon,
    isPointOnPolygonBoundary: isPointOnPolygonBoundary,
    isPointOnLineSegment: isPointOnLineSegment,
    getClosestPointOnSegment: getClosestPointOnSegment,
    doPolygonEdgesIntersect: doPolygonEdgesIntersect,
    doLineSegmentsIntersect: doLineSegmentsIntersect
  };

})(window);
