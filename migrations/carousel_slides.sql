CREATE TABLE IF NOT EXISTS `carousel_slides` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `image_url` VARCHAR(255) NOT NULL,
  `link` VARCHAR(255) NULL,
  `button_text` VARCHAR(50) NULL DEFAULT 'Selengkapnya',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample data
INSERT INTO `carousel_slides` (`title`, `description`, `image_url`, `link`, `button_text`, `active`, `sort_order`)
VALUES 
('Selamat Datang di Gema Hati Kudus', 'Portal berita dan informasi terkini seputar kegiatan Gereja Katolik', 'https://source.unsplash.com/random/1200x600/?church', '/about', 'Pelajari Lebih Lanjut', 1, 1),
('Jadwal Misa Mingguan', 'Temukan jadwal misa di gereja-gereja terdekat', 'https://source.unsplash.com/random/1200x600/?mass', '/schedule', 'Lihat Jadwal', 1, 2),
('Kegiatan Sosial', 'Mari bergabung dalam kegiatan sosial untuk membantu sesama', 'https://source.unsplash.com/random/1200x600/?charity', '/activities', 'Bergabung', 1, 3);
