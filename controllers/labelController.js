const { logger } = require('../utils/logger');
const { executeQuery } = require('../config/databaseConfig');
const { v4: uuidv4 } = require('uuid');
const { FALLBACK_LABELS } = require('../data/fallbackData');

// Mendapatkan label dengan sublabel (struktur hierarki)
exports.getLabelsWithSublabels = async (req, res) => {
  try {
    const labels = await executeQuery(async (connection) => {
      // Ambil semua label
      const [allLabels] = await connection.query(`
        SELECT l.*, p.label as parent_label
        FROM unique_labels l
        LEFT JOIN unique_labels p ON l.parent_id = p.id
        ORDER BY CASE WHEN l.parent_id IS NULL THEN 0 ELSE 1 END, l.label
      `);

      // Format semua label
      const formattedLabels = allLabels.map(row => ({
        id: parseInt(row.id),
        label: row.label,
        name: row.label, // Untuk kompatibilitas
        parent_id: row.parent_id ? parseInt(row.parent_id) : null,
        parent_label: row.parent_label || null,
        is_sublabel: row.parent_id !== null,
        slug: row.slug || row.label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''), // Gunakan slug dari database jika ada
        is_active: row.is_active !== undefined ? !!row.is_active : true, // Default ke true jika tidak ada
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

      // Filter label utama (tanpa parent_id)
      const mainLabels = formattedLabels.filter(label => !label.parent_id);

      // Tambahkan sublabel ke label utama
      const labelsWithSublabels = mainLabels.map(mainLabel => {
        const sublabels = formattedLabels.filter(label =>
          label.parent_id === mainLabel.id
        );

        return {
          ...mainLabel,
          sublabels: sublabels
        };
      });

      return labelsWithSublabels;
    });

    res.json(labels);
  } catch (error) {
    logger.error('Error fetching labels with sublabels:', error);
    res.status(500).json({
      message: 'Error fetching labels with sublabels',
      error: error.message
    });
  }
};

// Mendapatkan semua label unik
exports.getLabels = async (req, res) => {
  try {
    try {
      const labels = await executeQuery(async (connection) => {
        // Gunakan LEFT JOIN untuk mendapatkan informasi parent label
        const [rows] = await connection.query(`
          SELECT l.*, p.label as parent_label
          FROM unique_labels l
          LEFT JOIN unique_labels p ON l.parent_id = p.id
          ORDER BY CASE WHEN l.parent_id IS NULL THEN 0 ELSE 1 END, l.label
        `);

        return rows.map(row => ({
          ...row,
          id: parseInt(row.id),
          parent_id: row.parent_id ? parseInt(row.parent_id) : null,
          is_sublabel: row.parent_id !== null,
          slug: row.slug || row.label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''),
          is_active: row.is_active !== undefined ? !!row.is_active : true,
          created_at: row.created_at,
          updated_at: row.updated_at
        }));
      });
      res.json(labels);
    } catch (dbError) {
      logger.error('Database error fetching labels:', {
        error: dbError.message,
        stack: dbError.stack,
        service: 'label-service'
      });

      // Gunakan fallback data jika terjadi error database
      logger.warn('Using fallback data for labels', { service: 'label-service' });
      return res.json(FALLBACK_LABELS.labels);
    }
  } catch (error) {
    logger.error('Error fetching labels:', {
      error: error.message,
      stack: error.stack,
      service: 'label-service'
    });

    // Gunakan fallback data jika terjadi error
    return res.json(FALLBACK_LABELS.labels);
  }
};

// Membuat label baru
exports.createLabel = async (req, res) => {
  try {
    const { label, post_id, parent_id } = req.body;

    // Log untuk debugging
    console.log('Creating label with data:', { label, post_id, parent_id });
    console.log('parent_id type:', typeof parent_id);

    if (!label || label.trim() === '') {
      return res.status(400).json({ message: 'Label name is required' });
    }

    // Pastikan parent_id adalah number jika ada
    let parsedParentId = null;
    if (parent_id !== null && parent_id !== undefined) {
      parsedParentId = parseInt(parent_id);
      console.log('Parsed parent_id:', parsedParentId);

      if (isNaN(parsedParentId)) {
        return res.status(400).json({ message: 'Parent ID must be a valid number' });
      }

      // Validasi parent_id jika ada
      const parentExists = await executeQuery(async (connection) => {
        const [rows] = await connection.query('SELECT * FROM unique_labels WHERE id = ?', [parsedParentId]);
        const exists = rows.length > 0;
        console.log('Parent exists:', exists, 'for ID:', parsedParentId);
        return exists;
      });

      if (!parentExists) {
        return res.status(400).json({ message: 'Parent label not found' });
      }
    }

    const uniqueLabel = await executeQuery(async (connection) => {
      // Cari label berdasarkan nama dan parent_id
      // Ini memastikan kita bisa memiliki sublabel dengan nama yang sama di bawah parent yang berbeda
      let [existingLabel] = await connection.query(
        'SELECT * FROM unique_labels WHERE label = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))',
        [label.trim(), parsedParentId, parsedParentId]
      );

      console.log('Existing label check result:', existingLabel);

      if (existingLabel.length === 0) {
        // Gunakan parsedParentId jika ada
        console.log('No existing label found, creating new one with parent_id:', parsedParentId);

        // Generate slug dari label
        const slug = label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');

        const [result] = await connection.query(
          'INSERT INTO unique_labels (label, slug, parent_id, is_active) VALUES (?, ?, ?, ?)',
          [label.trim(), slug, parsedParentId, true]
        );

        console.log('Insert result:', result);

        [existingLabel] = await connection.query(
          'SELECT * FROM unique_labels WHERE id = ?',
          [result.insertId]
        );

        console.log('New label created:', existingLabel[0]);
      } else {
        // Jika label sudah ada, periksa apakah ini adalah permintaan untuk membuat sublabel
        // Jika ya, dan label sudah ada tetapi dengan parent_id yang berbeda, buat label baru
        const existingParentId = existingLabel[0].parent_id ? parseInt(existingLabel[0].parent_id) : null;
        console.log('Existing label found with parent_id:', existingParentId);
        console.log('Requested parent_id:', parsedParentId);

        if (parsedParentId !== null && existingParentId !== parsedParentId) {
          console.log('Creating new label with same name but different parent_id');

          // Generate slug dari label
          const slug = label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');

          const [result] = await connection.query(
            'INSERT INTO unique_labels (label, slug, parent_id, is_active) VALUES (?, ?, ?, ?)',
            [label.trim(), slug, parsedParentId, true]
          );

          console.log('Insert result for duplicate with different parent:', result);

          [existingLabel] = await connection.query(
            'SELECT * FROM unique_labels WHERE id = ?',
            [result.insertId]
          );

          console.log('New label created with different parent:', existingLabel[0]);
        } else {
          console.log('Using existing label:', existingLabel[0]);
        }
      }

      if (post_id) {
        console.log('Adding label to post:', post_id, existingLabel[0].id);
        await connection.query(
          'INSERT INTO post_labels (post_id, label_id) VALUES (?, ?)',
          [post_id, existingLabel[0].id]
        );
      }

      // Pastikan semua field diformat dengan benar
      const formattedLabel = {
        ...existingLabel[0],
        id: parseInt(existingLabel[0].id),
        parent_id: existingLabel[0].parent_id ? parseInt(existingLabel[0].parent_id) : null,
        slug: existingLabel[0].slug || existingLabel[0].label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''),
        is_active: existingLabel[0].is_active !== undefined ? !!existingLabel[0].is_active : true,
        created_at: existingLabel[0].created_at,
        updated_at: existingLabel[0].updated_at
      };

      console.log('Returning formatted label:', formattedLabel);
      return formattedLabel;
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
    const { label, parent_id } = req.body;
    if (!label || label.trim() === '') {
      return res.status(400).json({ message: 'Label name is required' });
    }

    // Validasi parent_id jika ada
    if (parent_id) {
      const parentExists = await executeQuery(async (connection) => {
        const [rows] = await connection.query('SELECT * FROM unique_labels WHERE id = ?', [parent_id]);
        return rows.length > 0;
      });

      if (!parentExists) {
        return res.status(400).json({ message: 'Parent label not found' });
      }

      // Pastikan parent_id bukan ID label itu sendiri
      if (parseInt(parent_id) === parseInt(req.params.id)) {
        return res.status(400).json({ message: 'Label cannot be its own parent' });
      }

      // Pastikan parent_id bukan salah satu sublabel dari label ini
      const isChildLabel = await executeQuery(async (connection) => {
        const [rows] = await connection.query('SELECT * FROM unique_labels WHERE parent_id = ?', [req.params.id]);
        return rows.some(row => parseInt(row.id) === parseInt(parent_id));
      });

      if (isChildLabel) {
        return res.status(400).json({ message: 'Cannot set a child label as parent' });
      }
    }

    const updatedLabel = await executeQuery(async (connection) => {
      // Generate slug dari label
      const slug = label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '');

      // Perbarui label, slug, dan parent_id
      const [result] = await connection.query(
        'UPDATE unique_labels SET label = ?, slug = ?, parent_id = ? WHERE id = ?',
        [label.trim(), slug, parent_id || null, req.params.id]
      );

      if (result.affectedRows === 0) {
        throw new Error('Unique label not found');
      }

      const [updatedRow] = await connection.query('SELECT * FROM unique_labels WHERE id = ?', [req.params.id]);
      return {
        ...updatedRow[0],
        id: parseInt(updatedRow[0].id),
        parent_id: updatedRow[0].parent_id ? parseInt(updatedRow[0].parent_id) : null,
        slug: updatedRow[0].slug || updatedRow[0].label.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''),
        is_active: updatedRow[0].is_active !== undefined ? !!updatedRow[0].is_active : true,
        created_at: updatedRow[0].created_at,
        updated_at: updatedRow[0].updated_at
      };
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
      // Periksa apakah label memiliki sublabel
      const [sublabels] = await connection.query('SELECT * FROM unique_labels WHERE parent_id = ?', [req.params.id]);

      if (sublabels.length > 0) {
        // Opsi 1: Hapus semua sublabel
        for (const sublabel of sublabels) {
          // Hapus relasi post_labels untuk sublabel
          await connection.query('DELETE FROM post_labels WHERE label_id = ?', [sublabel.id]);
          // Hapus sublabel
          await connection.query('DELETE FROM unique_labels WHERE id = ?', [sublabel.id]);
        }
      }

      // Hapus relasi post_labels untuk label utama
      await connection.query('DELETE FROM post_labels WHERE label_id = ?', [req.params.id]);

      // Hapus label utama
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

// Mendapatkan label berdasarkan slug
exports.getLabelBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({ message: 'Slug is required' });
    }

    const label = await executeQuery(async (connection) => {
      // Cari label berdasarkan slug
      const [rows] = await connection.query(`
        SELECT l.*, p.label as parent_label
        FROM unique_labels l
        LEFT JOIN unique_labels p ON l.parent_id = p.id
        WHERE l.slug = ?
      `, [slug]);

      if (rows.length === 0) {
        return null;
      }

      // Format label
      const formattedLabel = {
        ...rows[0],
        id: parseInt(rows[0].id),
        parent_id: rows[0].parent_id ? parseInt(rows[0].parent_id) : null,
        is_sublabel: rows[0].parent_id !== null,
        is_active: rows[0].is_active !== undefined ? !!rows[0].is_active : true,
        created_at: rows[0].created_at,
        updated_at: rows[0].updated_at
      };

      // Jika ini adalah sublabel, tambahkan informasi parent
      if (formattedLabel.parent_id) {
        formattedLabel.parent_label = rows[0].parent_label || null;
      }

      return formattedLabel;
    });

    if (!label) {
      return res.status(404).json({ message: 'Label not found' });
    }

    res.json(label);
  } catch (error) {
    logger.error('Error fetching label by slug:', error);
    res.status(500).json({
      message: 'Error fetching label by slug',
      error: error.message
    });
  }
};

// Alias untuk konsistensi dengan authRoutes.js
exports.addLabel = exports.createLabel;

// Gunakan getLabelsWithSublabels sebagai default untuk getAllLabels
exports.getAllLabels = exports.getLabelsWithSublabels;
