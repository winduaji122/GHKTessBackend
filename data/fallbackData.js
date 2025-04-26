// Fallback data untuk endpoint yang sering diakses
// Digunakan ketika terjadi error koneksi database

const FALLBACK_POSTS = {
  success: true,
  data: [
    {
      id: 'fallback-1',
      title: 'Artikel Sementara',
      content: 'Konten artikel sementara. Silakan coba lagi nanti.',
      excerpt: 'Konten artikel sementara. Silakan coba lagi nanti.',
      status: 'published',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      publish_date: new Date().toISOString(),
      image: null,
      author_id: 'system',
      author_name: 'System',
      is_featured: false,
      is_spotlight: false,
      labels: [],
      views: 0
    }
  ],
  pagination: {
    currentPage: 1,
    totalPages: 1,
    totalItems: 1,
    limit: 10
  }
};

const FALLBACK_FEATURED_POSTS = {
  success: true,
  posts: [
    {
      id: 'fallback-featured-1',
      title: 'Artikel Unggulan Sementara',
      content: 'Konten artikel unggulan sementara. Silakan coba lagi nanti.',
      excerpt: 'Konten artikel unggulan sementara. Silakan coba lagi nanti.',
      status: 'published',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      publish_date: new Date().toISOString(),
      image: null,
      author_id: 'system',
      author_name: 'System',
      is_featured: true,
      is_spotlight: false,
      labels: []
    }
  ]
};

const FALLBACK_SPOTLIGHT_POSTS = {
  success: true,
  posts: [
    {
      id: 'fallback-spotlight-1',
      title: 'Artikel Spotlight Sementara',
      content: 'Konten artikel spotlight sementara. Silakan coba lagi nanti.',
      excerpt: 'Konten artikel spotlight sementara. Silakan coba lagi nanti.',
      status: 'published',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      publish_date: new Date().toISOString(),
      image: null,
      author_id: 'system',
      author_name: 'System',
      is_featured: false,
      is_spotlight: true,
      labels: []
    }
  ]
};

const FALLBACK_LABELS = {
  success: true,
  labels: [
    { id: 1, label: 'Artikel' },
    { id: 2, label: 'Berita' },
    { id: 3, label: 'Renungan' }
  ]
};

const FALLBACK_CAROUSEL = {
  success: true,
  slides: [
    {
      id: 'fallback-carousel-1',
      title: 'Slide Sementara',
      description: 'Deskripsi slide sementara. Silakan coba lagi nanti.',
      image_url: null,
      order: 1,
      link: '/',
      active: true
    }
  ]
};

module.exports = {
  FALLBACK_POSTS,
  FALLBACK_FEATURED_POSTS,
  FALLBACK_SPOTLIGHT_POSTS,
  FALLBACK_LABELS,
  FALLBACK_CAROUSEL
};
