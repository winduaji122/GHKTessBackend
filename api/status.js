// API Status endpoint
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'https://ghk-tess.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Return status information
  return res.json({
    message: 'GHK Tess API Server',
    status: 'running',
    environment: process.env.NODE_ENV,
    baseUrl: process.env.BASE_URL,
    frontendUrl: process.env.FRONTEND_URL,
    timestamp: new Date().toISOString()
  });
};
