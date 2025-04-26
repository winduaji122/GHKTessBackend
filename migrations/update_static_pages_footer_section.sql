-- Update footer_section untuk Tentang Kami dan Kontak Kami menjadi 'links'
UPDATE static_pages 
SET footer_section = 'links' 
WHERE title IN ('Tentang Kami', 'Kontak Kami');
