-- Add status column to carousel_posts table
ALTER TABLE carousel_posts 
ADD COLUMN status ENUM('draft', 'published') NOT NULL DEFAULT 'draft' AFTER active;
