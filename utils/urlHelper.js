function getAbsoluteUrl(req, relativeUrl) {
    return `${req.protocol}://${req.get('host')}${relativeUrl}`;
  }
  
  module.exports = { getAbsoluteUrl };