const express = require('express');
const router = express.Router();
const staticPageController = require('../controllers/staticPageController');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');

// Public routes
router.get('/public/footer', staticPageController.getFooterPages);
router.get('/public/footer-sections', staticPageController.getFooterSections);
router.get('/public/slug/:slug', staticPageController.getPageBySlug);

// Protected routes (admin only)
router.get('/', verifyToken, staticPageController.getAllPages);
router.get('/:id', verifyToken, staticPageController.getPageById);
router.post('/', verifyToken, isAdmin, staticPageController.createPage);
router.put('/:id', verifyToken, isAdmin, staticPageController.updatePage);
router.delete('/:id', verifyToken, isAdmin, staticPageController.deletePage);

module.exports = router;
