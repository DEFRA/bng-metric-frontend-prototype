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

// Tiles Style Endpoint - proxies OS Vector Tile Styles API
router.get('/api/os/tiles/style', async function (req, res) {
  const apiKey = process.env.OS_PROJECT_API_KEY
  
  if (!apiKey) {
    console.error('OS_PROJECT_API_KEY not found in environment variables')
    return res.status(500).json({ error: 'API key not configured' })
  }
  
  const osUrl = `https://api.os.uk/maps/vector/v1/vts/resources/styles?srs=3857&key=${apiKey}`
  
  try {
    const response = await fetch(osUrl)
    
    if (!response.ok) {
      console.error(`OS API error: ${response.status} ${response.statusText}`)
      return res.status(response.status).json({ 
        error: 'OS API request failed',
        status: response.status 
      })
    }
    
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('Error fetching OS tiles style:', error)
    res.status(500).json({ error: 'Failed to fetch tile styles' })
  }
})

// Features Endpoint - proxies OS Features API (WFS)
router.get('/api/os/features', async function (req, res) {
  const apiKey = process.env.OS_PROJECT_API_KEY
  
  if (!apiKey) {
    console.error('OS_PROJECT_API_KEY not found in environment variables')
    return res.status(500).json({ error: 'API key not configured' })
  }
  
  // Build WFS query parameters
  const params = new URLSearchParams({
    service: 'WFS',
    request: 'GetFeature',
    version: '2.0.0',
    key: apiKey
  })
  
  // Pass through query parameters from the client
  const allowedParams = ['typeNames', 'bbox', 'count', 'startIndex', 'srsName', 'outputFormat']
  allowedParams.forEach(param => {
    if (req.query[param]) {
      params.append(param, req.query[param])
    }
  })
  
  const osUrl = `https://api.os.uk/features/v1/wfs?${params.toString()}`
  
  try {
    const response = await fetch(osUrl)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`OS Features API error: ${response.status} ${response.statusText}`, errorText)
      return res.status(response.status).json({ 
        error: 'OS Features API request failed',
        status: response.status,
        details: errorText
      })
    }
    
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('Error fetching OS features:', error)
    res.status(500).json({ error: 'Failed to fetch features' })
  }
})
