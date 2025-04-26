-- Create carousel_posts table
CREATE TABLE IF NOT EXISTS carousel_posts (
  id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  excerpt TEXT,
  image_url VARCHAR(255),
  side_image_url VARCHAR(255),
  button_text VARCHAR(50) DEFAULT 'Baca Artikel',
  active TINYINT(1) DEFAULT 1,
  publish_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  sort_order INT DEFAULT 0,
  slug VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
