const validateImageMiddleware = async (req, res, next) => {
  try {
    if (!req.body.existing_image) {
      return next();
    }

    const imagePath = normalizeImagePath(req.body.existing_image);
    const exists = await validateImage(imagePath);

    if (!exists) {
      return res.status(400).json({
        success: false,
        message: 'File gambar tidak valid'
      });
    }

    next();
  } catch (error) {
    logger.error('Error validating image:', error);
    res.status(500).json({
      success: false,
      message: 'Error validating image'
    });
  }
}; 