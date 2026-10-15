// FoodQueue Frontend Runtime Configuration
// This file is safe for production static hosting (e.g. GitHub Pages, Vercel, Netlify).
// Never place backend secrets, private keys, or database credentials in frontend files.
window.FOODQUEUE_CONFIG = window.FOODQUEUE_CONFIG || {};

(function () {
  // 1. Allow dynamic runtime override via URL query parameter: ?api=https://my-backend.com/api
  try {
    const params = new URLSearchParams(window.location.search);
    const queryApi = params.get('api');
    if (queryApi) {
      localStorage.setItem('foodqueue_api_url', queryApi.replace(/\/+$/, ''));
    }
  } catch {}

  // 2. Check for previously stored API base URL
  const storedApi = (() => {
    try {
      return localStorage.getItem('foodqueue_api_url');
    } catch {
      return null;
    }
  })();

  // 3. Fallback resolution:
  // If hosted locally, default to http://localhost:3000/api
  // If hosted on a static domain or cloud host, default to same-origin /api unless overridden
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const defaultApi = isLocal ? 'http://localhost:3000/api' : `${window.location.origin}/api`;

  window.FOODQUEUE_CONFIG = {
    API_BASE_URL: window.FOODQUEUE_CONFIG.API_BASE_URL || storedApi || defaultApi,
    SUPABASE_URL: window.FOODQUEUE_CONFIG.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: window.FOODQUEUE_CONFIG.SUPABASE_ANON_KEY || '',
    ...window.FOODQUEUE_CONFIG
  };
})();
