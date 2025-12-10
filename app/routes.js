//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

// Load environment variables from .env file
require('dotenv').config()

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

// Add your routes here

// WFS API test page
router.get('/test-wfs', function (req, res) {
  res.render('test-wfs')
});

// OS API Proxy Endpoints
// These endpoints proxy requests to Ordnance Survey APIs,
// keeping the API key secure on the server side

// Tiles Style Endpoint - proxies OS NGD Vector Tile Styles API
router.get('/api/os/tiles/style', async function (req, res) {
  const apiKey = process.env.OS_PROJECT_API_KEY
  
  if (!apiKey) {
    console.error('OS_PROJECT_API_KEY not found in environment variables')
    return res.status(500).json({ error: 'API key not configured' })
  }
  
  // Use ngd-base collection with EPSG:3857 (Web Mercator)
  const collectionId = 'ngd-base';
  const osUrl = `https://api.os.uk/maps/vector/ngd/ota/v1/collections/${collectionId}/styles/3857?key=${apiKey}`
  
  try {
    const response = await fetch(osUrl)
    
    if (!response.ok) {
      console.error(`OS NGD API error: ${response.status} ${response.statusText}`)
      const errorText = await response.text()
      console.error('Error details:', errorText)
      return res.status(response.status).json({ 
        error: 'OS NGD API request failed',
        status: response.status,
        details: errorText
      })
    }
    
    const data = await response.json()
    
    // Inject API key into tile source URLs
    if (data.sources) {
      Object.keys(data.sources).forEach(sourceKey => {
        const source = data.sources[sourceKey];
        if (source.tiles && Array.isArray(source.tiles)) {
          source.tiles = source.tiles.map(tileUrl => {
            // Add API key to tile URLs if not already present
            if (!tileUrl.includes('key=')) {
              const separator = tileUrl.includes('?') ? '&' : '?';
              return `${tileUrl}${separator}key=${apiKey}`;
            }
            return tileUrl;
          });
        }
      });
    }
    
    res.json(data)
  } catch (error) {
    console.error('Error fetching OS NGD tiles style:', error)
    res.status(500).json({ error: 'Failed to fetch tile styles' })
  }
})

// Tiles Endpoint - proxies OS NGD Vector Tile requests
// OGC API Tiles standard uses {z}/{y}/{x} order (TileMatrix/TileRow/TileCol)
router.get('/api/os/tiles/:collection/:z/:y/:x', async function (req, res) {
  const apiKey = process.env.OS_PROJECT_API_KEY
  
  if (!apiKey) {
    console.error('OS_PROJECT_API_KEY not found in environment variables')
    return res.status(500).json({ error: 'API key not configured' })
  }
  
  const { collection, z, y, x } = req.params
  const osUrl = `https://api.os.uk/maps/vector/ngd/ota/v1/collections/${collection}/tiles/3857/${z}/${y}/${x}?key=${apiKey}`
  
  console.log(`Fetching tile: ${collection}/${z}/${y}/${x} (TileMatrix/TileRow/TileCol)`)
  console.log(`OS URL: ${osUrl.replace(apiKey, 'REDACTED')}`)
  
  try {
    const response = await fetch(osUrl)
    
    if (!response.ok) {
      console.error(`OS NGD Tiles API error: ${response.status} ${response.statusText} for tile ${z}/${y}/${x}`)
      const errorText = await response.text()
      console.error('Error details:', errorText)
      return res.status(response.status).send('Tile not found')
    }
    
    // Get the tile data as a buffer
    // Note: Node.js fetch automatically decompresses gzip content
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    console.log(`✓ Tile fetched: ${buffer.length} bytes (decompressed)`)
    
    // Set appropriate headers for MVT
    // DO NOT set Content-Encoding - the data is already decompressed by Node.js fetch
    res.set('Content-Type', 'application/vnd.mapbox-vector-tile')
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Cache-Control', 'public, max-age=3600')
    
    res.send(buffer)
  } catch (error) {
    console.error('Error fetching OS NGD tile:', error)
    res.status(500).send('Failed to fetch tile')
  }
})

// Features Endpoint - proxies OS NGD Features API (OGC API Features)
router.get('/api/os/features/:collection/items', async function (req, res) {
  const apiKey = process.env.OS_PROJECT_API_KEY
  
  if (!apiKey) {
    console.error('OS_PROJECT_API_KEY not found in environment variables')
    return res.status(500).json({ error: 'API key not configured' })
  }
  
  const collection = req.params.collection
  
  // Build OGC API Features query parameters
  const params = new URLSearchParams({
    key: apiKey
  })
  
  // Pass through query parameters from the client
  const allowedParams = ['bbox', 'bbox-crs', 'limit', 'offset', 'crs']
  allowedParams.forEach(param => {
    if (req.query[param]) {
      params.append(param, req.query[param])
    }
  })
  
  const osUrl = `https://api.os.uk/features/ngd/ofa/v1/collections/${collection}/items?${params.toString()}`
  
  try {
    const response = await fetch(osUrl)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`OS NGD Features API error: ${response.status} ${response.statusText}`, errorText)
      return res.status(response.status).json({ 
        error: 'OS NGD Features API request failed',
        status: response.status,
        details: errorText
      })
    }
    
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('Error fetching OS NGD features:', error);
    res.status(500).json({ error: 'Failed to fetch features' });
  }
});

// Red Line Boundary API Endpoints

// Save red line boundary to session
router.post('/api/save-red-line-boundary', function(req, res) {
  req.session.data['redLineBoundary'] = req.body;
  console.log('Red line boundary saved to session');
  res.json({ success: true, redirect: '/on-site-habitat-baseline' });
});

// Get red line boundary from session
router.get('/api/red-line-boundary', function(req, res) {
  const boundary = req.session.data['redLineBoundary'] || null;
  res.json(boundary);
});

// Habitat Parcels API Endpoints

// Save habitat parcels to session
router.post('/api/save-habitat-parcels', function(req, res) {
  req.session.data['habitatParcels'] = req.body;
  console.log('Habitat parcels saved to session');
  res.json({ success: true, redirect: '/habitat-parcels-summary' });
});

// Get habitat parcels from session
router.get('/api/habitat-parcels', function(req, res) {
  const parcels = req.session.data['habitatParcels'] || null;
  res.json(parcels);
});
