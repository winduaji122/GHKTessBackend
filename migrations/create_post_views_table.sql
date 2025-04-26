-- Cek apakah tabel post_views sudah ada
CREATE TABLE IF NOT EXISTS `post_views` (
  `id` VARCHAR(36) NOT NULL,
  `post_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `viewer_ip` VARCHAR(45) NOT NULL,
  `viewed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `post_views_post_id_idx` (`post_id`),
  INDEX `post_views_user_id_idx` (`user_id`),
  INDEX `post_views_viewed_at_idx` (`viewed_at`),
  CONSTRAINT `fk_post_views_post_id`
    FOREIGN KEY (`post_id`)
    REFERENCES `posts` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_post_views_user_id`
    FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tambahkan kolom views ke tabel posts jika belum ada
ALTER TABLE `posts` 
ADD COLUMN IF NOT EXISTS `views` INT NOT NULL DEFAULT 0 AFTER `version`;

-- Tambahkan index untuk kolom views
ALTER TABLE `posts` 
ADD INDEX IF NOT EXISTS `posts_views_idx` (`views`);

-- Tambahkan trigger untuk menghapus views saat post dihapus
DROP TRIGGER IF EXISTS `before_post_delete`;
DELIMITER //
CREATE TRIGGER `before_post_delete`
BEFORE DELETE ON `posts`
FOR EACH ROW
BEGIN
  DELETE FROM `post_views` WHERE `post_id` = OLD.id;
END //
DELIMITER ;
