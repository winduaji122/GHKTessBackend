require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { executeQuery } = require('../config/databaseConfig');
const { logger } = require('../utils/logger');

async function fixDuplicateSlugs() {
  try {
    const posts = await executeQuery(async (connection) => {
      const [rows] = await connection.query('SELECT id, title, slug FROM posts');
      return rows;
    });
    
    const slugCounts = {};

    for (const post of posts) {
      if (!post.slug) {
        post.slug = generateSlug(post.title);
      }

      if (slugCounts[post.slug]) {
        slugCounts[post.slug]++;
        post.slug = `${post.slug}-${slugCounts[post.slug]}`;
      } else {
        slugCounts[post.slug] = 1;
      }

      await executeQuery(async (connection) => {
        await connection.query('UPDATE posts SET slug = ? WHERE id = ?', [post.slug, post.id]);
      });
      
      logger.info(`Updated slug for post ${post.id}: ${post.slug}`);
    }

    logger.info('Finished fixing duplicate slugs');
  } catch (error) {
    logger.error('Error fixing duplicate slugs:', error);
  }
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-')
    + '-' + uuidv4().substr(0, 8);
}

fixDuplicateSlugs();