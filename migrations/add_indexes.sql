-- Tambahkan indeks untuk meningkatkan performa query

-- Indeks untuk posts
ALTER TABLE posts ADD INDEX idx_status_deleted (status, deleted_at);
ALTER TABLE posts ADD INDEX idx_author_id (author_id);
ALTER TABLE posts ADD INDEX idx_created_at (created_at);
ALTER TABLE posts ADD INDEX idx_slug (slug);
ALTER TABLE posts ADD INDEX idx_is_featured (is_featured);
ALTER TABLE posts ADD INDEX idx_is_spotlight (is_spotlight);

-- Indeks untuk post_labels
ALTER TABLE post_labels ADD INDEX idx_label_id (label_id);

-- Indeks untuk comments
ALTER TABLE comments ADD INDEX idx_post_id_deleted (post_id, deleted_at);

-- Indeks untuk likes
ALTER TABLE likes ADD INDEX idx_post_id (post_id);

-- Indeks untuk post_views
ALTER TABLE post_views ADD INDEX idx_post_id (post_id);
ALTER TABLE post_views ADD INDEX idx_ip_address (ip_address);
ALTER TABLE post_views ADD INDEX idx_user_id (user_id);

-- Indeks untuk user_tokens
ALTER TABLE user_tokens ADD INDEX idx_user_id_type (user_id, type);
ALTER TABLE user_tokens ADD INDEX idx_expires_at (expires_at);
