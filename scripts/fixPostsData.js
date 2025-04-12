require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { executeQuery } = require('../config/databaseConfig');
const UniqueLabel = require('../models/UniqueLabel');
const { logger } = require('../utils/logger');
const { slugAlreadyExists } = require('../utils/slugUtils');
const { getAbsoluteUrl } = require('../utils/urlHelper');
const { v4: uuidv4 } = require('uuid');

async function fixPostsData() {
  try {
    await executeQuery(async () => {
      // 1. Perbaiki slug yang duplikat
      const posts = await executeQuery('SELECT id, title, slug FROM posts');
      for (const post of posts) {
        if (await slugAlreadyExists(post.slug, post.id)) {
          const newSlug = `${post.slug}-${uuidv4().substr(0, 8)}`;
          await executeQuery('UPDATE posts SET slug = ? WHERE id = ?', [newSlug, post.id]);
          logger.info(`Fixed duplicate slug for post ${post.id}: ${post.slug} -> ${newSlug}`);
        }
      }

      // 2. Perbaiki label yang tidak valid
      const postLabels = await executeQuery('SELECT DISTINCT label_id FROM post_labels');
      for (const { label_id } of postLabels) {
        const label = await UniqueLabel.findById(label_id);
        if (!label) {
          await executeQuery('DELETE FROM post_labels WHERE label_id = ?', [label_id]);
          logger.info(`Removed invalid label_id ${label_id} from post_labels`);
        }
      }

      // 3. Perbaiki URL gambar
      const postsWithImages = await executeQuery('SELECT id, image FROM posts WHERE image IS NOT NULL');
      const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
      for (const post of postsWithImages) {
        if (!post.image.startsWith('http')) {
          const newImageUrl = getAbsoluteUrl({ protocol: 'http', get: () => baseUrl.split('//')[1] }, post.image);
          await executeQuery('UPDATE posts SET image = ? WHERE id = ?', [newImageUrl, post.id]);
          logger.info(`Fixed image URL for post ${post.id}: ${post.image} -> ${newImageUrl}`);
        }
      }

      // 4. Perbaiki tanggal publikasi yang tidak valid
      await executeQuery(`
        UPDATE posts 
        SET publish_date = CURRENT_TIMESTAMP 
        WHERE publish_date IS NULL OR publish_date > CURRENT_TIMESTAMP
      `);
      logger.info('Fixed invalid publish dates');

      // 5. Perbaiki post tanpa penulis
      const defaultAuthorId = process.env.DEFAULT_AUTHOR_ID;
      if (defaultAuthorId) {
        await executeQuery('UPDATE posts SET author_id = ? WHERE author_id IS NULL', [defaultAuthorId]);
        logger.info(`Assigned default author ${defaultAuthorId} to posts without an author`);
      } else {
        logger.warn('DEFAULT_AUTHOR_ID not set in .env file. Skipping fix for posts without an author.');
      }

      logger.info('Successfully fixed posts data');
    });
  } catch (error) {
    logger.error('Error fixing posts data:', error);
    throw error;
  }
}

fixPostsData().then(() => {
  logger.info('Script completed');
  process.exit(0);
}).catch((error) => {
  logger.error('Script failed:', error);
  process.exit(1);
});