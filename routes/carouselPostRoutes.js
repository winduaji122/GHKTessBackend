const express = require('express');
const router = express.Router();
const carouselPostController = require('../controllers/carouselPostController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Public routes
router.get('/', carouselPostController.getAllCarouselPosts);
router.get('/id/:id', verifyToken, isAdmin, carouselPostController.getCarouselPostById);
router.get('/slug/:slug', carouselPostController.getCarouselPostBySlug);
router.get('/public/:slug', carouselPostController.getPublicCarouselPostBySlug);

// Admin routes
router.post('/', verifyToken, isAdmin, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'side_image', maxCount: 1 }
]), carouselPostController.createCarouselPost);

router.put('/:id', verifyToken, isAdmin, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'side_image', maxCount: 1 }
]), carouselPostController.updateCarouselPost);

router.delete('/:id', verifyToken, isAdmin, carouselPostController.deleteCarouselPost);

// Status update route
router.put('/status/:id', verifyToken, isAdmin, carouselPostController.updateCarouselPostStatus);

module.exports = router;
