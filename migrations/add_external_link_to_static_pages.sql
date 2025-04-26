-- Add external_link column to static_pages table
ALTER TABLE static_pages ADD COLUMN external_link VARCHAR(255) DEFAULT NULL AFTER footer_section;
