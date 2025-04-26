-- Menambahkan kolom post_id ke tabel carousel_slides
ALTER TABLE carousel_slides ADD COLUMN post_id CHAR(36) NULL;

-- Menambahkan foreign key ke tabel posts
ALTER TABLE carousel_slides ADD CONSTRAINT fk_carousel_slides_post_id
FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL;

-- Menambahkan indeks untuk mempercepat pencarian
CREATE INDEX idx_carousel_slides_post_id ON carousel_slides(post_id);
