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

  // ============================================================
  // Fill Tool Validation Functions
  // ============================================================

  /**
   * Check if two polygons are adjacent (share an edge or touch at more than a single point)
   * Adjacent means they share at least one edge segment, not just touch at a corner
   * @param {ol.geom.Polygon} polygon1
   * @param {ol.geom.Polygon} polygon2
   * @returns {boolean} True if polygons are adjacent
   */
  function arePolygonsAdjacent(polygon1, polygon2) {
    if (!polygon1 || !polygon2) return false;

    // Quick extent check first - if extents don't touch, they can't be adjacent
    const extent1 = polygon1.getExtent();
    const extent2 = polygon2.getExtent();
    const buffer = EPSILON * 10;  // Small buffer for floating point tolerance

    const bufferedExtent1 = [
      extent1[0] - buffer,
      extent1[1] - buffer,
      extent1[2] + buffer,
      extent1[3] + buffer
    ];

    if (!ol.extent.intersects(bufferedExtent1, extent2)) {
      return false;
    }

    const coords1 = polygon1.getCoordinates()[0];
    const coords2 = polygon2.getCoordinates()[0];

    // Count how many vertices of polygon1 lie on the boundary of polygon2
    let sharedVertexCount = 0;
    let sharedEdgeCount = 0;

    // Check for shared edges (segments that overlap)
    for (let i = 0; i < coords1.length - 1; i++) {
      const seg1Start = coords1[i];
      const seg1End = coords1[i + 1];

      for (let j = 0; j < coords2.length - 1; j++) {
        const seg2Start = coords2[j];
        const seg2End = coords2[j + 1];

        // Check if segments share a portion (overlap)
        if (doSegmentsOverlap(seg1Start, seg1End, seg2Start, seg2End)) {
          sharedEdgeCount++;
          if (sharedEdgeCount >= 1) {
            return true;  // Found a shared edge
          }
        }
      }
    }

    // Also check if they share multiple vertices (which indicates adjacency)
    for (let i = 0; i < coords1.length - 1; i++) {
      const coord1 = coords1[i];
      for (let j = 0; j < coords2.length - 1; j++) {
        const coord2 = coords2[j];
        if (coordsNearlyEqual(coord1, coord2)) {
          sharedVertexCount++;
        }
      }
    }

    // If they share at least 2 vertices, they likely share an edge
    return sharedVertexCount >= 2;
  }

  /**
   * Check if two line segments overlap (share more than just an endpoint)
   * @param {Array} a1 - Start of segment A
   * @param {Array} a2 - End of segment A
   * @param {Array} b1 - Start of segment B
   * @param {Array} b2 - End of segment B
   * @returns {boolean}
   */
  function doSegmentsOverlap(a1, a2, b1, b2) {
    // First check if segments are collinear
    const d1 = direction(a1, a2, b1);
    const d2 = direction(a1, a2, b2);

    if (Math.abs(d1) > EPSILON || Math.abs(d2) > EPSILON) {
      // Not collinear
      return false;
    }

    // Segments are collinear, check if they overlap
    // Project onto x-axis (or y-axis if segment is vertical)
    const useY = Math.abs(a2[0] - a1[0]) < EPSILON;
    const axis = useY ? 1 : 0;

    const aMin = Math.min(a1[axis], a2[axis]);
    const aMax = Math.max(a1[axis], a2[axis]);
    const bMin = Math.min(b1[axis], b2[axis]);
    const bMax = Math.max(b1[axis], b2[axis]);

    // Check for overlap (more than just touching at a point)
    const overlapStart = Math.max(aMin, bMin);
    const overlapEnd = Math.min(aMax, bMax);
    const overlapLength = overlapEnd - overlapStart;

    // Require minimum overlap length to count as shared edge
    return overlapLength > EPSILON * 10;
  }

  /**
   * Check if two coordinates are nearly equal (within tolerance)
   * @param {Array} c1 - First coordinate [x, y]
   * @param {Array} c2 - Second coordinate [x, y]
   * @returns {boolean}
   */
  function coordsNearlyEqual(c1, c2) {
    if (!c1 || !c2) return false;
    return Math.abs(c1[0] - c2[0]) < EPSILON * 10 && Math.abs(c1[1] - c2[1]) < EPSILON * 10;
  }

  /**
   * Check if all polygons in an array form a contiguous (connected) group
   * Uses graph-based approach: polygons are nodes, adjacency creates edges
   * All polygons must be reachable from any other polygon
   * @param {Array} polygons - Array of ol.geom.Polygon
   * @returns {boolean} True if all polygons are connected
   */
  function arePolygonsContiguous(polygons) {
    if (!polygons || polygons.length === 0) return false;
    if (polygons.length === 1) return true;

    // Build adjacency graph
    const n = polygons.length;
    const adjacencyList = new Array(n).fill(null).map(() => []);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (arePolygonsAdjacent(polygons[i], polygons[j])) {
          adjacencyList[i].push(j);
          adjacencyList[j].push(i);
        }
      }
    }

    // BFS to check connectivity
    const visited = new Array(n).fill(false);
    const queue = [0];
    visited[0] = true;
    let visitedCount = 1;

    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of adjacencyList[current]) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          visitedCount++;
          queue.push(neighbor);
        }
      }
    }

    // All polygons should be reachable
    return visitedCount === n;
  }

  /**
   * Validate a fill selection before merging
   * Checks that all selected polygons form a valid contiguous region
   * @param {Array} selectedPolygons - Array of { geometry: ol.geom.Polygon, ... }
   * @returns {Object} { valid: boolean, error: string|null }
   */
  function validateFillSelection(selectedPolygons) {
    if (!selectedPolygons || selectedPolygons.length === 0) {
      return {
        valid: false,
        error: 'No polygons selected.'
      };
    }

    if (selectedPolygons.length === 1) {
      // Single polygon is always valid
      return { valid: true, error: null };
    }

    // Extract geometries
    const geometries = selectedPolygons.map(s => {
      if (s.geometry) {
        const type = s.geometry.getType();
        if (type === 'Polygon') {
          return s.geometry;
        } else if (type === 'MultiPolygon') {
          // Convert first polygon of multipolygon
          const coords = s.geometry.getCoordinates()[0];
          return new ol.geom.Polygon(coords);
        }
      }
      return null;
    }).filter(g => g !== null);

    if (geometries.length !== selectedPolygons.length) {
      return {
        valid: false,
        error: 'Some selected features do not have valid polygon geometries.'
      };
    }

    // Check contiguity
    if (!arePolygonsContiguous(geometries)) {
      return {
        valid: false,
        error: 'Selected polygons are not all connected. The red-line boundary must be a single contiguous area.'
      };
    }

    return { valid: true, error: null };
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
    doLineSegmentsIntersect: doLineSegmentsIntersect,
    // Fill tool validation functions
    arePolygonsAdjacent: arePolygonsAdjacent,
    arePolygonsContiguous: arePolygonsContiguous,
    validateFillSelection: validateFillSelection
  };

})(window);
