-- Create static_pages table
CREATE TABLE IF NOT EXISTS `static_pages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL UNIQUE,
  `content` TEXT NOT NULL,
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `show_in_footer` TINYINT(1) NOT NULL DEFAULT 1,
  `footer_section` VARCHAR(50) DEFAULT 'main',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_static_pages_slug` (`slug`),
  INDEX `idx_static_pages_footer` (`show_in_footer`, `footer_section`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample data
INSERT INTO `static_pages` (`title`, `slug`, `content`, `is_published`, `show_in_footer`, `footer_section`)
VALUES 
('Tentang Kami', 'tentang-kami', '<h2>Tentang Gema Hati Kudus</h2><p>Gema Hati Kudus adalah platform media katolik yang bertujuan untuk menyebarkan kabar baik dan nilai-nilai kristiani melalui artikel, renungan, dan konten inspiratif lainnya.</p><p>Kami berkomitmen untuk menjadi sumber informasi dan inspirasi bagi umat Katolik dan semua orang yang mencari kedamaian spiritual.</p>', 1, 1, 'about'),
('Kebijakan Privasi', 'kebijakan-privasi', '<h2>Kebijakan Privasi</h2><p>Kami menghargai privasi Anda. Halaman ini menjelaskan bagaimana kami mengumpulkan, menggunakan, dan melindungi informasi pribadi Anda saat Anda menggunakan situs web kami.</p><p>Dengan menggunakan situs web kami, Anda menyetujui kebijakan privasi ini.</p>', 1, 1, 'main'),
('Syarat dan Ketentuan', 'syarat-dan-ketentuan', '<h2>Syarat dan Ketentuan</h2><p>Dengan mengakses dan menggunakan situs web ini, Anda menyetujui untuk terikat oleh syarat dan ketentuan berikut.</p><p>Harap baca dengan seksama sebelum menggunakan situs web kami.</p>', 1, 1, 'main'),
('FAQ', 'faq', '<h2>Pertanyaan yang Sering Diajukan</h2><p><strong>Apa itu Gema Hati Kudus?</strong><br>Gema Hati Kudus adalah platform media katolik yang menyediakan konten inspiratif dan informatif.</p><p><strong>Bagaimana cara berlangganan newsletter?</strong><br>Anda dapat berlangganan newsletter kami dengan mengisi formulir di halaman utama.</p>', 1, 1, 'links'),
('Kontak Kami', 'kontak', '<h2>Kontak Kami</h2><p>Anda dapat menghubungi kami melalui:</p><ul><li>Email: info@gemahati.id</li><li>Telepon: +62 123 4567 890</li><li>Alamat: Jl. Contoh No. 123, Jakarta</li></ul>', 1, 1, 'about');
