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

  // 2. Check for previously stored API base URL (sanitizing stale Netlify references)
  const storedApi = (() => {
    try {
      const val = localStorage.getItem('foodqueue_api_url');
      if (val && (val.includes('netlify.app') || val === window.location.origin || val === `${window.location.origin}/api`)) {
        localStorage.removeItem('foodqueue_api_url');
        return null;
      }
      return val;
    } catch {
      return null;
    }
  })();

  // 3. Fallback resolution:
  // Local environment: http://localhost:3000/api
  // Production / Cloud environment: https://swynex-task-4-complete-application.onrender.com/api
  const PRODUCTION_API_URL = 'https://swynex-task-4-complete-application.onrender.com/api';
  const LOCAL_API_URL = 'http://localhost:3000/api';

  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );
  const defaultApi = isLocal ? LOCAL_API_URL : PRODUCTION_API_URL;

  window.FOODQUEUE_CONFIG = {
    API_BASE_URL: window.FOODQUEUE_CONFIG.API_BASE_URL || storedApi || defaultApi,
    SUPABASE_URL: window.FOODQUEUE_CONFIG.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: window.FOODQUEUE_CONFIG.SUPABASE_ANON_KEY || '',
    ...window.FOODQUEUE_CONFIG
  };
})();
