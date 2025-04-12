const Post = require('../models/Post');
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

exports.search = async (req, res) => {
  try {
    const { 
      q = '', 
      label_id, 
      page = 1, 
      limit = 10,
      sort = 'relevance'
    } = req.query;

    if (label_id && isNaN(parseInt(label_id))) {
      return res.status(400).json({
        success: false,
        message: 'Label ID harus berupa number'
      });
    }

    const offset = (page - 1) * limit;
    let whereConditions = ['p.status = "published"'];
    let params = [];
    let orderByClause;

    // Base query
    const baseQuery = `
      SELECT DISTINCT
        p.*,
        u.name as author_name,
        GROUP_CONCAT(
          DISTINCT JSON_OBJECT(
            'id', CAST(ul.id AS UNSIGNED),
            'label', ul.label
          )
        ) as labels
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN unique_labels ul ON pl.label_id = ul.id
    `;

    // Tambahkan kondisi pencarian dengan single MATCH
    if (q.trim()) {
      whereConditions.push(`MATCH(p.title, p.content) AGAINST(? IN BOOLEAN MODE)`);
      params.push(`${q}*`);
    }

    // Tambahkan filter label
    if (label_id) {
      whereConditions.push('pl.label_id = ?');
      params.push(label_id);
    }

    // Tentukan ORDER BY dengan single MATCH untuk relevance
    if (sort === 'relevance' && q.trim()) {
      orderByClause = `MATCH(p.title, p.content) AGAINST(? IN BOOLEAN MODE) DESC`;
      params.push(`${q}*`);
    } else {
      orderByClause = 'p.publish_date DESC';
    }

    // Gabungkan query
    const query = `
      ${baseQuery}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY p.id
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `;

    // Tambahkan limit dan offset ke params
    params.push(Number(limit), offset);

    // Execute query
    const results = await executeQuery(async (connection) => {
      const [rows] = await connection.query(query, params);
      
      // Query untuk total hasil
      const countQuery = `
        SELECT COUNT(DISTINCT p.id) as total
        FROM posts p
        LEFT JOIN post_labels pl ON p.id = pl.post_id
        WHERE ${whereConditions.join(' AND ')}
      `;
      
      const [countResult] = await connection.query(countQuery, 
        params.slice(0, params.length - 2)
      );

      return {
        success: true,
        data: rows.map(post => ({
          ...post,
          labels: post.labels ? JSON.parse(`[${post.labels}]`).map(label => ({
            ...label,
            id: parseInt(label.id)
          })) : []
        })),
        pagination: {
          totalItems: countResult[0].total,
          currentPage: Number(page),
          totalPages: Math.ceil(countResult[0].total / limit),
          limit: Number(limit)
        }
      };
    });

    res.json(results);

  } catch (error) {
    console.error('Error in search:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan dalam pencarian',
      error: error.message
    });
  }
};

exports.searchByLabel = async (req, res) => {
  try {
    const { label, page = 1, limit = 10 } = req.query;

    if (!label || isNaN(parseInt(label))) {
      return res.status(400).json({ 
        message: 'Label ID harus berupa number yang valid' 
      });
    }

    const offset = (Number(page) - 1) * Number(limit);

    const results = await executeQuery(async (connection) => {
      const sql = `
        SELECT 
          p.*,
          GROUP_CONCAT(
            DISTINCT JSON_OBJECT(
              'id', CAST(ul.id AS UNSIGNED),
              'label', ul.label
            )
          ) AS labels
        FROM posts p
        JOIN post_labels pl ON p.id = pl.post_id
        JOIN unique_labels ul ON pl.label_id = ul.id
        WHERE ul.id = ?
        GROUP BY p.id
        ORDER BY p.publish_date DESC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await connection.query(sql, [
        parseInt(label), 
        Number(limit), 
        (Number(page) - 1) * Number(limit)
      ]);
      const [[{ count }]] = await connection.query(
        `SELECT COUNT(DISTINCT p.id) as count 
         FROM posts p
         JOIN post_labels pl ON p.id = pl.post_id
         JOIN unique_labels ul ON pl.label_id = ul.id
         WHERE ul.id = ?`,
        [label]
      );

      return { results: rows, total: count };
    });

    // Format hasil dengan ID number
    const formattedResults = results.results.map(post => ({
      ...post,
      labels: post.labels ? 
        JSON.parse(`[${post.labels}]`).map(label => ({
          ...label,
          id: parseInt(label.id)
        })) : []
    }));

    res.json({
      results: formattedResults,
      totalResults: results.total,
      totalPages: Math.ceil(results.total / Number(limit)),
      currentPage: Number(page)
    });

  } catch (error) {
    logger.error('Search by label error:', error);
    res.status(500).json({ 
      message: 'Internal server error', 
      error: error.toString() 
    });
  }
};

exports.advancedSearch = async (req, res) => {
  try {
    const { 
      q = '', 
      page = 1, 
      limit = 10,
      status,
      label_id,
      featured,
      sort = 'created_at:desc'
    } = req.query;

    logger.info('Advanced search request:', { 
      service: 'user-service',
      query: q,
      status,
      label_id,
      featured,
      sort,
      page,
      limit
    });

    const offset = (page - 1) * limit;
    let whereConditions = ['1=1']; // Base condition
    let params = [];

    // Base query dengan FULLTEXT search
    let sql = `
      SELECT DISTINCT
        p.*,
        u.name as author_name,
        GROUP_CONCAT(
          DISTINCT JSON_OBJECT(
            'id', CAST(ul.id AS UNSIGNED),
            'label', ul.label
          )
        ) as labels
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_labels pl ON p.id = pl.post_id
      LEFT JOIN unique_labels ul ON pl.label_id = ul.id
      WHERE 
    `;

    // Tambahkan kondisi pencarian
    if (q?.trim()) {
      whereConditions.push(`MATCH(p.title, p.content) AGAINST(? IN BOOLEAN MODE)`);
      params.push(`${q.trim()}*`);
    }

    // Filter status
    if (status && status !== 'all') {
      whereConditions.push('p.status = ?');
      params.push(status);
    }

    // Filter label
    if (label_id) {
      whereConditions.push('pl.label_id = ?');
      params.push(label_id);
    }

    // Filter featured
    if (featured && featured !== 'all') {
      whereConditions.push('p.is_featured = ?');
      params.push(featured === 'featured' ? 1 : 0);
    }

    sql += whereConditions.join(' AND ');
    sql += ' GROUP BY p.id';

    // Sorting
    switch(sort) {
      case 'title:asc':
        sql += ' ORDER BY p.title ASC';
        break;
      case 'title:desc':
        sql += ' ORDER BY p.title DESC';
        break;
      case 'views:desc':
        sql += ' ORDER BY p.views DESC';
        break;
      default:
        sql += ' ORDER BY p.created_at DESC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    // Execute query
    const results = await executeQuery(async (connection) => {
      const [rows] = await connection.query(sql, params);
      
      // Get total count
      const countSql = `SELECT COUNT(DISTINCT p.id) as total FROM posts p 
                       LEFT JOIN post_labels pl ON p.id = pl.post_id 
                       WHERE ${whereConditions.join(' AND ')}`;
      const [countResult] = await connection.query(countSql, params.slice(0, -2));
      
      return {
        data: rows,
        total: countResult[0].total
      };
    });

    // Format response
    const response = {
      success: true,
      data: results.data.map(post => ({
        ...post,
        labels: post.labels ? 
          JSON.parse(`[${post.labels}]`).map(label => ({
            ...label,
            id: parseInt(label.id)
          })) : []
      })),
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(results.total / Number(limit)),
        totalItems: results.total,
        itemsPerPage: Number(limit)
      }
    };

    res.json(response);

  } catch (error) {
    logger.error('Error in advanced search:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan dalam pencarian',
      error: error.message 
    });
  }
};
