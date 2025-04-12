const express = require('express');
const router = express.Router();
const carouselController = require('../controllers/carouselController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Debug: Cetak isi carouselController
console.log('carouselController:', Object.keys(carouselController));

// Public routes
router.get('/', carouselController.getAllSlides);

// Admin routes
router.get('/admin', verifyToken, isAdmin, carouselController.getAllSlidesAdmin);
router.get('/:id', verifyToken, isAdmin, carouselController.getSlideById);
router.post('/', verifyToken, isAdmin, upload.single('image'), carouselController.createSlide);
router.put('/:id', verifyToken, isAdmin, upload.single('image'), carouselController.updateSlide);
router.delete('/:id', verifyToken, isAdmin, carouselController.deleteSlide);
router.post('/order', verifyToken, isAdmin, carouselController.updateSlidesOrder);

module.exports = router;
