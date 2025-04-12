const express = require('express');
const router = express.Router();
const labelController = require('../controllers/labelController');
const { isAdmin, isAuthenticated } = require('../middleware/authMiddleware');
const { logger } = require('../utils/logger');
const { getAllLabels, addLabelToPost, removeLabelFromPost } = require('../config/databaseConfig');

// Mendapatkan semua label
router.get('/', async (req, res) => {
  try {
    const labels = await getAllLabels();
    res.json(labels);
  } catch (error) {
    logger.error('Error in GET /labels:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil label.' });
  }
});

// Membuat label baru (hanya untuk admin)
router.post('/', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await labelController.createLabel(req, res);
  } catch (error) {
    logger.error('Error in POST /labels:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat membuat label.' });
  }
});

// Mendapatkan label berdasarkan ID post
router.get('/post/:post_id', async (req, res) => {
  try {
    await labelController.getLabelsByPostId(req, res);
  } catch (error) {
    logger.error('Error in GET /labels/post/:post_id:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil label untuk post.' });
  }
});

// Memperbarui label (hanya untuk admin)
router.put('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await labelController.updateLabel(req, res);
  } catch (error) {
    logger.error('Error in PUT /labels/:id:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat memperbarui label.' });
  }
});

// Menghapus label (hanya untuk admin)
router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await labelController.deleteLabel(req, res);
  } catch (error) {
    logger.error('Error in DELETE /labels/:id:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menghapus label.' });
  }
});

// Mendapatkan semua label unik
router.get('/unique', async (req, res) => {
  try {
    await labelController.getAllUniqueLabels();
  } catch (error) {
    logger.error('Error in GET /labels/unique:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil label unik.' });
  }
});

// Menambahkan label ke post
router.post('/add-to-post', isAuthenticated, async (req, res) => {
  try {
    const { postId, labelId } = req.body;
    const result = await addLabelToPost(postId, labelId);
    res.json(result);
  } catch (error) {
    logger.error('Error in POST /labels/add-to-post:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menambahkan label ke post.' });
  }
});

// Menghapus label dari post
router.delete('/remove-from-post/:postId/:labelId', isAuthenticated, async (req, res) => {
  try {
    const { postId, labelId } = req.params;
    const result = await removeLabelFromPost(postId, labelId);
    if (result) {
      res.json({ message: 'Label berhasil dihapus dari post.' });
    } else {
      res.status(404).json({ message: 'Label atau post tidak ditemukan.' });
    }
  } catch (error) {
    logger.error('Error in DELETE /labels/remove-from-post/:postId/:labelId:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat menghapus label dari post.' });
  }
});

// Mendapatkan label populer
router.get('/popular', async (req, res) => {
  try {
    const popularLabels = await getPopularLabels();
    res.json(popularLabels);
  } catch (error) {
    logger.error('Error in GET /labels/popular:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil label populer.' });
  }
});

module.exports = router;
