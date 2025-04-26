const { logger } = require('../utils/logger');
const db = require('../config/databaseConfig');
const { formatImageUrl } = require('../utils/imageHandler');

/**
 * Mendapatkan statistik dashboard
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      let stats = {};
      let statsLastMonth = {};

      // Dapatkan tanggal untuk bulan ini dan bulan lalu
      const now = new Date();
      const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const firstDayTwoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

      // Format tanggal untuk query SQL
      const thisMonthStart = firstDayThisMonth.toISOString().split('T')[0];
      const lastMonthStart = firstDayLastMonth.toISOString().split('T')[0];
      const twoMonthsAgoStart = firstDayTwoMonthsAgo.toISOString().split('T')[0];

      // Statistik post
      if (userRole === 'admin') {
        // Admin melihat semua post
        const [postCountResult] = await connection.query(
          `SELECT COUNT(*) as total_posts FROM posts WHERE deleted_at IS NULL`
        );
        stats.posts = postCountResult[0].total_posts;

        // Post bulan lalu
        const [postCountLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_posts FROM posts
           WHERE deleted_at IS NULL AND created_at < ?`,
          [thisMonthStart]
        );
        statsLastMonth.posts = postCountLastMonthResult[0].total_posts;
      } else {
        // Writer hanya melihat post miliknya
        const [postCountResult] = await connection.query(
          `SELECT COUNT(*) as total_posts FROM posts WHERE author_id = ? AND deleted_at IS NULL`,
          [userId]
        );
        stats.posts = postCountResult[0].total_posts;

        // Post bulan lalu
        const [postCountLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_posts FROM posts
           WHERE author_id = ? AND deleted_at IS NULL AND created_at < ?`,
          [userId, thisMonthStart]
        );
        statsLastMonth.posts = postCountLastMonthResult[0].total_posts;
      }

      // Statistik views dari tabel post_views
      if (userRole === 'admin') {
        // Admin melihat semua views
        const [viewsResult] = await connection.query(
          `SELECT COUNT(*) as total_views FROM post_views`
        );
        stats.views = viewsResult[0].total_views || 0;

        // Views bulan lalu
        const [viewsLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_views FROM post_views
           WHERE viewed_at < ?`,
          [thisMonthStart]
        );
        statsLastMonth.views = viewsLastMonthResult[0].total_views || 0;
      } else {
        // Writer hanya melihat views post miliknya
        const [viewsResult] = await connection.query(
          `SELECT COUNT(*) as total_views
           FROM post_views pv
           JOIN posts p ON pv.post_id = p.id
           WHERE p.author_id = ?`,
          [userId]
        );
        stats.views = viewsResult[0].total_views || 0;

        // Views bulan lalu
        const [viewsLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_views
           FROM post_views pv
           JOIN posts p ON pv.post_id = p.id
           WHERE p.author_id = ? AND pv.viewed_at < ?`,
          [userId, thisMonthStart]
        );
        statsLastMonth.views = viewsLastMonthResult[0].total_views || 0;
      }

      // Statistik komentar
      if (userRole === 'admin') {
        // Admin melihat semua komentar
        const [commentsResult] = await connection.query(
          `SELECT COUNT(*) as total_comments FROM comments WHERE deleted_at IS NULL`
        );
        stats.comments = commentsResult[0].total_comments;

        // Komentar bulan lalu
        const [commentsLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_comments FROM comments
           WHERE deleted_at IS NULL AND created_at < ?`,
          [thisMonthStart]
        );
        statsLastMonth.comments = commentsLastMonthResult[0].total_comments;
      } else {
        // Writer hanya melihat komentar post miliknya
        const [commentsResult] = await connection.query(
          `SELECT COUNT(*) as total_comments
           FROM comments c
           JOIN posts p ON c.post_id = p.id
           WHERE p.author_id = ? AND c.deleted_at IS NULL`,
          [userId]
        );
        stats.comments = commentsResult[0].total_comments;

        // Komentar bulan lalu
        const [commentsLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_comments
           FROM comments c
           JOIN posts p ON c.post_id = p.id
           WHERE p.author_id = ? AND c.deleted_at IS NULL AND c.created_at < ?`,
          [userId, thisMonthStart]
        );
        statsLastMonth.comments = commentsLastMonthResult[0].total_comments;
      }

      // Statistik likes
      if (userRole === 'admin') {
        // Admin melihat semua likes
        const [likesResult] = await connection.query(
          `SELECT COUNT(*) as total_likes FROM likes`
        );
        stats.likes = likesResult[0].total_likes;

        // Likes bulan lalu
        const [likesLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_likes FROM likes
           WHERE created_at < ?`,
          [thisMonthStart]
        );
        statsLastMonth.likes = likesLastMonthResult[0].total_likes;
      } else {
        // Writer hanya melihat likes post miliknya
        const [likesResult] = await connection.query(
          `SELECT COUNT(*) as total_likes
           FROM likes l
           JOIN posts p ON l.post_id = p.id
           WHERE p.author_id = ?`,
          [userId]
        );
        stats.likes = likesResult[0].total_likes;

        // Likes bulan lalu
        const [likesLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_likes
           FROM likes l
           JOIN posts p ON l.post_id = p.id
           WHERE p.author_id = ? AND l.created_at < ?`,
          [userId, thisMonthStart]
        );
        statsLastMonth.likes = likesLastMonthResult[0].total_likes;
      }

      // Statistik writer (hanya untuk admin)
      if (userRole === 'admin') {
        const [writerCountResult] = await connection.query(
          `SELECT COUNT(*) as total_writers FROM users WHERE role = 'writer'`
        );
        stats.writers = writerCountResult[0].total_writers;

        // Writers bulan lalu
        const [writerCountLastMonthResult] = await connection.query(
          `SELECT COUNT(*) as total_writers FROM users
           WHERE role = 'writer' AND created_at < ?`,
          [thisMonthStart]
        );
        statsLastMonth.writers = writerCountLastMonthResult[0].total_writers;
      }

      // Hitung perubahan persentase
      const calculateChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      // Statistik perubahan (persentase)
      stats.changes = {
        posts: calculateChange(stats.posts, statsLastMonth.posts),
        views: calculateChange(stats.views, statsLastMonth.views),
        comments: calculateChange(stats.comments, statsLastMonth.comments),
        likes: calculateChange(stats.likes, statsLastMonth.likes),
        writers: userRole === 'admin' ? calculateChange(stats.writers, statsLastMonth.writers) : undefined
      };

      res.json(stats);
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil statistik dashboard',
      error: error.message
    });
  }
};

/**
 * Mendapatkan post terbaru
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
exports.getRecentPosts = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const limit = parseInt(req.query.limit) || 5;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      let query, params;

      if (userRole === 'admin') {
        // Admin melihat semua post terbaru
        query = `
          SELECT
            p.id, p.title, p.slug, p.image, p.status, p.created_at,
            u.name as author_name,
            (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id) as views,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) as comments_count,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count
          FROM posts p
          LEFT JOIN users u ON p.author_id = u.id
          WHERE p.deleted_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT ?
        `;
        params = [limit];
      } else {
        // Writer hanya melihat post miliknya
        query = `
          SELECT
            p.id, p.title, p.slug, p.image, p.status, p.created_at,
            u.name as author_name,
            (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id) as views,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) as comments_count,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count
          FROM posts p
          LEFT JOIN users u ON p.author_id = u.id
          WHERE p.author_id = ? AND p.deleted_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT ?
        `;
        params = [userId, limit];
      }

      const [posts] = await connection.query(query, params);

      // Format data post
      const formattedPosts = posts.map(post => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        image: post.image ? formatImageUrl(post.image) : null,
        status: post.status,
        date: formatDate(post.created_at),
        author_name: post.author_name,
        views: post.views || 0,
        comments_count: post.comments_count || 0,
        likes_count: post.likes_count || 0
      }));

      res.json(formattedPosts);
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error fetching recent posts:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil post terbaru',
      error: error.message
    });
  }
};

/**
 * Mendapatkan aktivitas terbaru
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
exports.getRecentActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const limit = parseInt(req.query.limit) || 5;

    // Gunakan koneksi langsung dari db
    const connection = await db.getConnection();
    try {
      let activities = [];

      // Komentar terbaru
      let commentQuery, commentParams;

      if (userRole === 'admin') {
        // Admin melihat semua komentar terbaru
        commentQuery = `
          SELECT
            c.id, c.content, c.created_at,
            p.id as post_id, p.title as post_title,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM comments c
          JOIN posts p ON c.post_id = p.id
          JOIN users u ON c.user_id = u.id
          WHERE c.deleted_at IS NULL
          ORDER BY c.created_at DESC
          LIMIT ?
        `;
        commentParams = [limit];
      } else {
        // Writer hanya melihat komentar post miliknya
        commentQuery = `
          SELECT
            c.id, c.content, c.created_at,
            p.id as post_id, p.title as post_title,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM comments c
          JOIN posts p ON c.post_id = p.id
          JOIN users u ON c.user_id = u.id
          WHERE p.author_id = ? AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC
          LIMIT ?
        `;
        commentParams = [userId, limit];
      }

      const [comments] = await connection.query(commentQuery, commentParams);

      // Format komentar terbaru
      const commentActivities = comments.map(comment => ({
        id: `comment-${comment.id}`,
        type: 'comment',
        title: 'Komentar baru',
        description: `${comment.user_name} mengomentari post "${comment.post_title}"`,
        time: formatTimeAgo(comment.created_at),
        user: {
          id: comment.user_id,
          name: comment.user_name,
          role: comment.user_role
        },
        post: {
          id: comment.post_id,
          title: comment.post_title
        },
        created_at: comment.created_at
      }));

      activities = activities.concat(commentActivities);

      // Like terbaru
      let likeQuery, likeParams;

      if (userRole === 'admin') {
        // Admin melihat semua like terbaru
        likeQuery = `
          SELECT
            l.id, l.created_at,
            p.id as post_id, p.title as post_title,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM likes l
          JOIN posts p ON l.post_id = p.id
          JOIN users u ON l.user_id = u.id
          ORDER BY l.created_at DESC
          LIMIT ?
        `;
        likeParams = [limit];
      } else {
        // Writer hanya melihat like post miliknya
        likeQuery = `
          SELECT
            l.id, l.created_at,
            p.id as post_id, p.title as post_title,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM likes l
          JOIN posts p ON l.post_id = p.id
          JOIN users u ON l.user_id = u.id
          WHERE p.author_id = ?
          ORDER BY l.created_at DESC
          LIMIT ?
        `;
        likeParams = [userId, limit];
      }

      const [likes] = await connection.query(likeQuery, likeParams);

      // Format like terbaru
      const likeActivities = likes.map(like => ({
        id: `like-${like.id}`,
        type: 'like',
        title: 'Like baru',
        description: `${like.user_name} menyukai post "${like.post_title}"`,
        time: formatTimeAgo(like.created_at),
        user: {
          id: like.user_id,
          name: like.user_name,
          role: like.user_role
        },
        post: {
          id: like.post_id,
          title: like.post_title
        },
        created_at: like.created_at
      }));

      activities = activities.concat(likeActivities);

      // Post terbaru
      let postQuery, postParams;

      if (userRole === 'admin') {
        // Admin melihat semua post terbaru
        postQuery = `
          SELECT
            p.id, p.title, p.status, p.created_at,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM posts p
          JOIN users u ON p.author_id = u.id
          WHERE p.deleted_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT ?
        `;
        postParams = [limit];
      } else {
        // Writer hanya melihat post miliknya
        postQuery = `
          SELECT
            p.id, p.title, p.status, p.created_at,
            u.id as user_id, u.name as user_name, u.role as user_role
          FROM posts p
          JOIN users u ON p.author_id = u.id
          WHERE p.author_id = ? AND p.deleted_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT ?
        `;
        postParams = [userId, limit];
      }

      const [posts] = await connection.query(postQuery, postParams);

      // Format post terbaru
      const postActivities = posts.map(post => ({
        id: `post-${post.id}`,
        type: 'post',
        title: 'Post baru',
        description: `${post.user_name} membuat post baru "${post.title}"`,
        time: formatTimeAgo(post.created_at),
        user: {
          id: post.user_id,
          name: post.user_name,
          role: post.user_role
        },
        post: {
          id: post.id,
          title: post.title,
          status: post.status
        },
        created_at: post.created_at
      }));

      activities = activities.concat(postActivities);

      // Urutkan aktivitas berdasarkan waktu terbaru
      activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Ambil hanya sejumlah limit
      activities = activities.slice(0, limit);

      res.json(activities);
    } catch (error) {
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('Error fetching recent activities:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil aktivitas terbaru',
      error: error.message
    });
  }
};

// Helper functions

const formatDate = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Hari ini';
  } else if (diffDays === 1) {
    return 'Kemarin';
  } else if (diffDays < 7) {
    return `${diffDays} hari yang lalu`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} minggu yang lalu`;
  } else {
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
};

const formatTimeAgo = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffMinutes = Math.floor(diffTime / (1000 * 60));

  if (diffMinutes < 1) {
    return 'Baru saja';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} menit yang lalu`;
  } else if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} jam yang lalu`;
  } else {
    const days = Math.floor(diffMinutes / 1440);
    return `${days} hari yang lalu`;
  }
};
