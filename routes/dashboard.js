const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

// Mendapatkan statistik dashboard
router.get('/stats', isAuthenticated, dashboardController.getDashboardStats);

// Mendapatkan post terbaru
router.get('/recent-posts', isAuthenticated, dashboardController.getRecentPosts);

// Mendapatkan aktivitas terbaru
router.get('/recent-activities', isAuthenticated, dashboardController.getRecentActivities);

module.exports = router;
