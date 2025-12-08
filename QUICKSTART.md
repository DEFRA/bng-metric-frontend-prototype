# Quick Start: Polygon Drawing with Snapping

## 🚀 Start the Prototype

```bash
npm start
```

Then navigate to: **http://localhost:3000/map**

## ✏️ How to Draw a Polygon

1. **Zoom in** to at least zoom level 12 (UK area visible)
2. **Double-click** anywhere to start drawing
   - A blue circle appears showing where your point will snap
3. **Click** to place each vertex
   - Orange circles mark placed vertices
   - The polygon outline updates live as you move the mouse
4. **Hover over the first vertex** (it turns yellow)
5. **Click the yellow vertex** to close the polygon

## 🎯 What Gets Snapped?

The cursor automatically snaps to:
- ✅ Building outlines (Zoomstack_LocalBuildings)
- ✅ Roads - local, regional, national
- ✅ Waterlines
- ✅ Railway lines

**Snapping is active only at zoom level 12 or higher**

## 🔘 UI Buttons

- **Cancel Drawing** - Clear current polygon and start over
- **Export GeoJSON** - Download polygon as GeoJSON file (EPSG:4326)

## 💻 Developer API

### Get Current Polygon

```javascript
// Get live coordinates array
const coords = window.SnapDrawing.getCurrentPolygonCoords();
console.log(coords); // [[x,y], [x,y], ...]

// Get as GeoJSON (EPSG:3857)
const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();
```

### Save to Backend

```javascript
const geojson = window.SnapDrawing.getDrawnPolygonGeoJSON();

fetch('/api/save-polygon', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(geojson)
});
```

### Cancel Drawing

```javascript
window.SnapDrawing.cancelDrawing();
```

## 📁 Files to Review

- **`app/assets/javascripts/snapping.js`** - Core implementation
- **`app/assets/javascripts/map.js`** - Integration & UI controls
- **`app/views/map.html`** - Map page with instructions
- **`SNAPPING_IMPLEMENTATION.md`** - Full technical documentation

## 🐛 Troubleshooting

### Empty Features / No Snapping

If you see empty feature collections in the console, use the **WFS Diagnostic Tool**:

**Navigate to: http://localhost:3000/test-wfs**

This tool helps you:
- Test different layer types
- Verify API connectivity
- See actual API requests and responses
- Identify which layers return data

**Quick diagnostic commands in browser console:**

```javascript
// Test WFS API connection
await window.SnapDrawing.testWFSConnection()

// Check current snap index status
window.SnapDrawing.getSnapIndexInfo()

// Force refresh snap data
window.SnapDrawing.forceRefreshSnapData()
```

**Common fixes:**
1. Ensure API key has Features API access enabled
2. Use MasterMap Topography layers (not Zoomstack)
3. Zoom to level 12+ in a UK location
4. Check Network tab in DevTools for API errors

**See `WFS_DEBUGGING_GUIDE.md` for detailed troubleshooting steps**

### Other Issues

**No blue circle appearing?**
- Ensure you've double-clicked to start drawing
- Check that snapping.js loaded correctly (view page source)
- Zoom in to level 12 or higher

**Polygon won't close?**
- Make sure you have at least 3 vertices placed
- Hover directly over the first (orange) vertex until it turns yellow
- The closing tolerance is 10 pixels

## 📝 Example Use Case

1. Navigate to a specific building in London (zoom in close)
2. Double-click to start drawing
3. Notice how the cursor snaps to the building edges
4. Click around the building perimeter
5. Close the polygon by clicking the first vertex
6. Click "Export GeoJSON" to download
7. The exported file contains accurate building outline coordinates

## 🔑 API Key


**For production:** Replace with your own API key from https://osdatahub.os.uk/
This should eb placed in the .env file as needed

## ⚡ Performance Notes

- WFS data fetches are throttled (300ms)
- Maximum 100 features per request with automatic pagination
- Geometries are simplified for performance
- Snap index refreshes when you pan/zoom the map
- Hidden features (snap index) are not rendered

## 📚 More Information

See **`SNAPPING_IMPLEMENTATION.md`** for:
- Complete API reference
- Technical architecture
- All acceptance criteria verification
- Advanced usage examples

