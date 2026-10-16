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

  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  // 3. In production, safely purge any stale demo tokens or profiles so guest checkout works cleanly
  if (!isLocal) {
    try {
      localStorage.removeItem('foodqueue_demo_token');
      localStorage.removeItem('foodqueue_demo_profile');
      localStorage.removeItem('foodqueue_demo_owner_token');
    } catch {}
  }

  // 4. Runtime Supabase config from query parameters or localStorage
  try {
    const params = new URLSearchParams(window.location.search);
    const querySbUrl = params.get('supabase_url');
    const querySbKey = params.get('supabase_anon_key');
    if (querySbUrl) localStorage.setItem('foodqueue_supabase_url', querySbUrl.replace(/\/+$/, ''));
    if (querySbKey) localStorage.setItem('foodqueue_supabase_anon_key', querySbKey);
  } catch {}

  const storedSbUrl = (() => { try { return localStorage.getItem('foodqueue_supabase_url'); } catch { return null; } })();
  const storedSbKey = (() => { try { return localStorage.getItem('foodqueue_supabase_anon_key'); } catch { return null; } })();

  // 5. Fallback resolution:
  // Local environment: http://localhost:3000/api
  // Production / Cloud environment: https://swynex-task-4-complete-application.onrender.com/api
  const PRODUCTION_API_URL = 'https://swynex-task-4-complete-application.onrender.com/api';
  const LOCAL_API_URL = 'http://localhost:3000/api';
  const defaultApi = isLocal ? LOCAL_API_URL : PRODUCTION_API_URL;

  window.FOODQUEUE_CONFIG = {
    API_BASE_URL: window.FOODQUEUE_CONFIG.API_BASE_URL || storedApi || defaultApi,
    SUPABASE_URL: window.FOODQUEUE_CONFIG.SUPABASE_URL || storedSbUrl || '',
    SUPABASE_ANON_KEY: window.FOODQUEUE_CONFIG.SUPABASE_ANON_KEY || storedSbKey || '',
    isLocal,
    ...window.FOODQUEUE_CONFIG
  };
})();
