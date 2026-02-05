/* ARCHIVE-35 Main JavaScript */

// ===== Photo Data Store =====
let photosData = { photos: [] };
let filteredPhotos = [];
let currentPhotoIndex = 0;

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadPhotos();
  initLightbox();
  initSearch();
  initLazyLoading();
});

// ===== Navigation =====
function initNavigation() {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      nav.classList.toggle('active');
      navToggle.classList.toggle('active');
    });

    // Close nav on link click (mobile)
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('active');
        navToggle.classList.remove('active');
      });
    });
  }

  // Set active nav link
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
}

// ===== Load Photos Data =====
async function loadPhotos() {
  try {
    const response = await fetch('data/photos.json');
    photosData = await response.json();
    filteredPhotos = [...photosData.photos];

    // Render galleries if elements exist
    const galleryGrid = document.getElementById('gallery-grid');
    const collectionGrid = document.getElementById('collection-grid');
    const featuredGrid = document.getElementById('featured-grid');

    if (galleryGrid) renderGallery(galleryGrid, filteredPhotos);
    if (collectionGrid) renderCollectionGallery();
    if (featuredGrid) renderFeatured(featuredGrid);

  } catch (error) {
    console.error('Error loading photos:', error);
  }
}

// ===== Render Gallery =====
function renderGallery(container, photos) {
  container.innerHTML = photos.map((photo, index) => `
    <div class="gallery-item" data-index="${index}" data-id="${photo.id}">
      <img
        data-src="${photo.thumbnail}"
        alt="${photo.title}"
        class="lazy"
      >
      <div class="gallery-item-overlay">
        <h4 class="gallery-item-title">${photo.title}</h4>
        <p class="gallery-item-location">${photo.location}</p>
      </div>
    </div>
  `).join('');

  // Re-init lazy loading for new images
  initLazyLoading();

  // Add click handlers
  container.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      openLightbox(index);
    });
  });
}

// ===== Render Collection Gallery =====
function renderCollectionGallery() {
  const collectionId = new URLSearchParams(window.location.search).get('id');
  const collectionGrid = document.getElementById('collection-grid');
  const collectionTitle = document.getElementById('collection-title');
  const collectionDesc = document.getElementById('collection-desc');

  if (!collectionId || !collectionGrid) return;

  const collectionPhotos = photosData.photos.filter(p => p.collection === collectionId);
  filteredPhotos = collectionPhotos;

  if (collectionPhotos.length > 0) {
    if (collectionTitle) collectionTitle.textContent = collectionPhotos[0].collectionTitle;
    if (collectionDesc) collectionDesc.textContent = `${collectionPhotos.length} photographs from ${collectionPhotos[0].location}`;
  }

  renderGallery(collectionGrid, collectionPhotos);
}

// ===== Render Featured (Home Page) =====
function renderFeatured(container) {
  // Show first 6 photos as featured
  const featured = photosData.photos.slice(0, 6);
  renderGallery(container, featured);
}

// ===== Lightbox =====
function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  // Close button
  lightbox.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);

  // Navigation
  lightbox.querySelector('.lightbox-prev')?.addEventListener('click', () => navigateLightbox(-1));
  lightbox.querySelector('.lightbox-next')?.addEventListener('click', () => navigateLightbox(1));

  // Close on background click
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });
}

function openLightbox(index) {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox || !filteredPhotos[index]) return;

  currentPhotoIndex = index;
  updateLightboxContent();
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

function navigateLightbox(direction) {
  currentPhotoIndex += direction;

  if (currentPhotoIndex < 0) currentPhotoIndex = filteredPhotos.length - 1;
  if (currentPhotoIndex >= filteredPhotos.length) currentPhotoIndex = 0;

  updateLightboxContent();
}

function updateLightboxContent() {
  const photo = filteredPhotos[currentPhotoIndex];
  if (!photo) return;

  const lightbox = document.getElementById('lightbox');
  const img = lightbox.querySelector('.lightbox-image');
  const title = lightbox.querySelector('.lightbox-title');
  const location = lightbox.querySelector('.lightbox-location');
  const buyBtn = lightbox.querySelector('.lightbox-buy');

  if (img) img.src = photo.full;
  if (title) title.textContent = photo.title;
  if (location) location.textContent = photo.location;
  if (buyBtn) buyBtn.href = photo.buyUrl;
}

// ===== Lazy Loading =====
function initLazyLoading() {
  const lazyImages = document.querySelectorAll('img.lazy:not(.loaded)');

  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.onload = () => img.classList.add('loaded');
          observer.unobserve(img);
        }
      });
    }, {
      rootMargin: '50px 0px',
      threshold: 0.01
    });

    lazyImages.forEach(img => imageObserver.observe(img));
  } else {
    // Fallback for older browsers
    lazyImages.forEach(img => {
      img.src = img.dataset.src;
      img.classList.add('loaded');
    });
  }
}

// ===== Search =====
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const resultsCount = document.getElementById('results-count');
  const filterTags = document.querySelectorAll('.filter-tag');

  if (!searchInput) return;

  let activeFilters = [];

  // Search input handler
  searchInput.addEventListener('input', debounce((e) => {
    const query = e.target.value.toLowerCase().trim();
    performSearch(query, activeFilters);
  }, 300));

  // Filter tag handlers
  filterTags.forEach(tag => {
    tag.addEventListener('click', () => {
      const filter = tag.dataset.filter;

      if (filter === 'all') {
        activeFilters = [];
        filterTags.forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
      } else {
        document.querySelector('.filter-tag[data-filter="all"]')?.classList.remove('active');
        tag.classList.toggle('active');

        if (activeFilters.includes(filter)) {
          activeFilters = activeFilters.filter(f => f !== filter);
        } else {
          activeFilters.push(filter);
        }

        if (activeFilters.length === 0) {
          document.querySelector('.filter-tag[data-filter="all"]')?.classList.add('active');
        }
      }

      performSearch(searchInput.value.toLowerCase().trim(), activeFilters);
    });
  });
}

function performSearch(query, filters) {
  const searchResults = document.getElementById('search-results');
  const resultsCount = document.getElementById('results-count');

  if (!searchResults) return;

  filteredPhotos = photosData.photos.filter(photo => {
    // Text search
    const matchesQuery = !query ||
      photo.title.toLowerCase().includes(query) ||
      photo.location.toLowerCase().includes(query) ||
      photo.tags.some(tag => tag.toLowerCase().includes(query)) ||
      photo.collectionTitle.toLowerCase().includes(query);

    // Tag filters
    const matchesFilters = filters.length === 0 ||
      filters.some(filter => photo.tags.includes(filter) || photo.collection === filter);

    return matchesQuery && matchesFilters;
  });

  if (resultsCount) {
    resultsCount.textContent = `${filteredPhotos.length} photo${filteredPhotos.length !== 1 ? 's' : ''} found`;
  }

  renderGallery(searchResults, filteredPhotos);
}

// ===== Utility Functions =====
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ===== Collections Page =====
function getCollections() {
  const collections = {};

  photosData.photos.forEach(photo => {
    if (!collections[photo.collection]) {
      collections[photo.collection] = {
        id: photo.collection,
        title: photo.collectionTitle,
        location: photo.location,
        count: 0,
        thumbnail: photo.thumbnail
      };
    }
    collections[photo.collection].count++;
  });

  return Object.values(collections);
}

// Export for use in HTML
window.Archive35 = {
  loadPhotos,
  renderGallery,
  getCollections,
  openLightbox,
  closeLightbox
};
