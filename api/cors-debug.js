// CORS Debug endpoint
module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || 'https://ghk-tess.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Return debug information
  return res.json({
    message: 'CORS Debug Endpoint',
    headers: req.headers,
    origin: req.headers.origin,
    host: req.headers.host,
    method: req.method,
    url: req.url,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      FRONTEND_URL: process.env.FRONTEND_URL,
      BASE_URL: process.env.BASE_URL
    },
    timestamp: new Date().toISOString()
  });
};
