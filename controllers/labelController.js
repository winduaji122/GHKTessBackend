const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');
const { v4: uuidv4 } = require('uuid');

// Mendapatkan semua label unik
exports.getLabels = async (req, res) => {
  try {
    const labels = await executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM unique_labels ORDER BY id');
      return rows.map(row => ({
        ...row,
        id: parseInt(row.id)
      }));
    });
    res.json(labels);
  } catch (error) {
    logger.error('Error fetching labels:', error);
    res.status(500).json({ message: 'Error fetching labels', error: error.message });
  }
};

// Membuat label baru
exports.createLabel = async (req, res) => {
  try {
    const { label, post_id } = req.body;
    if (!label || label.trim() === '') {
      return res.status(400).json({ message: 'Label name is required' });
    }
    
    const uniqueLabel = await executeQuery(async (connection) => {
      let [existingLabel] = await connection.query(
        'SELECT * FROM unique_labels WHERE label = ?', 
        [label.trim()]
      );
      
      if (existingLabel.length === 0) {
        const [result] = await connection.query(
          'INSERT INTO unique_labels (label) VALUES (?)', 
          [label.trim()]
        );
        
        [existingLabel] = await connection.query(
          'SELECT * FROM unique_labels WHERE id = ?',
          [result.insertId]
        );
      }
      
      if (post_id) {
        await connection.query(
          'INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)', 
          [post_id, existingLabel[0].id]
        );
      }
      
      return {
        ...existingLabel[0],
        id: parseInt(existingLabel[0].id)
      };
    });
    
    res.status(201).json(uniqueLabel);
  } catch (error) {
    logger.error('Error creating label:', error);
    res.status(500).json({ 
      message: 'Error creating label', 
      error: error.message 
    });
  }
};

// Mendapatkan label berdasarkan ID post
exports.getLabelsByPostId = async (req, res) => {
  try {
    const labels = await executeQuery(async (connection) => {
      const [rows] = await connection.query(`
        SELECT ul.* FROM unique_labels ul
        JOIN post_labels pl ON ul.id = pl.label_id
        WHERE pl.post_id = ?
      `, [req.params.post_id]);
      return rows.map(row => ({
        ...row,
        id: parseInt(row.id)
      }));
    });
    res.json(labels);
  } catch (error) {
    logger.error('Error fetching labels for post:', error);
    res.status(500).json({ message: 'Error fetching labels for post', error: error.message });
  }
};

// Memperbarui label
exports.updateLabel = async (req, res) => {
  try {
    const { label } = req.body;
    if (!label || label.trim() === '') {
      return res.status(400).json({ message: 'Label name is required' });
    }
    const updatedLabel = await executeQuery(async (connection) => {
      const [result] = await connection.query('UPDATE unique_labels SET label = ? WHERE id = ?', [label.trim(), req.params.id]);
      if (result.affectedRows === 0) {
        throw new Error('Unique label not found');
      }
      const [updatedRow] = await connection.query('SELECT * FROM unique_labels WHERE id = ?', [req.params.id]);
      return updatedRow[0];
    });
    res.json(updatedLabel);
  } catch (error) {
    logger.error('Error updating label:', error);
    if (error.message === 'Label already exists') {
      res.status(400).json({ message: 'Label already exists' });
    } else if (error.message === 'Unique label not found') {
      res.status(404).json({ message: 'Label not found' });
    } else {
      res.status(500).json({ message: 'Error updating label', error: error.message });
    }
  }
};

// Menghapus label
exports.deleteLabel = async (req, res) => {
  try {
    await executeQuery(async (connection) => {
      await connection.query('DELETE FROM post_labels WHERE label_id = ?', [req.params.id]);
      const [result] = await connection.query('DELETE FROM unique_labels WHERE id = ?', [req.params.id]);
      if (result.affectedRows === 0) {
        throw new Error('Unique label not found');
      }
    });
    res.json({ message: 'Label deleted successfully' });
  } catch (error) {
    logger.error('Error deleting label:', error);
    if (error.message === 'Unique label not found') {
      res.status(404).json({ message: 'Label not found' });
    } else {
      res.status(500).json({ message: 'Error deleting label', error: error.message });
    }
  }
};

// Mendapatkan semua label unik
exports.getAllUniqueLabels = async (req, res) => {
  try {
    const connection = await getConnection();
    const [labels] = await connection.query(
      'SELECT DISTINCT id, name FROM labels WHERE status = ?',
      ['active']
    );
    
    await releaseConnection(connection);
    return res.status(200).json(labels);
  } catch (error) {
    logger.error('Error fetching unique labels:', error);
    return res.status(500).json({ message: 'Gagal mengambil data label' });
  }
};

// Menambahkan label ke post
exports.addLabelToPost = async (req, res) => {
  try {
    const { post_id, label_id } = req.body;
    if (!post_id || !label_id) {
      return res.status(400).json({ message: 'Post ID and Label ID are required' });
    }

    const numericLabelId = parseInt(label_id);
    if (isNaN(numericLabelId)) {
      return res.status(400).json({ message: 'Label ID harus berupa number' });
    }

    await executeQuery(async (connection) => {
      await connection.query(
        'INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)', 
        [post_id, numericLabelId]
      );
    });
    res.status(201).json({ message: 'Label added to post successfully' });
  } catch (error) {
    logger.error('Error adding label to post:', error);
    res.status(500).json({ message: 'Error adding label to post', error: error.message });
  }
};

// Menghapus label dari post
exports.removeLabelFromPost = async (req, res) => {
  try {
    const { post_id, label_id } = req.params;
    const result = await executeQuery(async (connection) => {
      const [result] = await connection.query('DELETE FROM post_labels WHERE post_id = ? AND label_id = ?', [post_id, label_id]);
      return result.affectedRows > 0;
    });
    if (result) {
      res.json({ message: 'Label removed from post successfully' });
    } else {
      res.status(404).json({ message: 'Label not found for this post' });
    }
  } catch (error) {
    logger.error('Error removing label from post:', error);
    res.status(500).json({ message: 'Error removing label from post', error: error.message });
  }
};

// Alias untuk konsistensi dengan authRoutes.js
exports.addLabel = exports.createLabel;
exports.getAllLabels = exports.getAllUniqueLabels;
