const CONFIG = window.FOODQUEUE_CONFIG || {};
const API_BASE_URL = CONFIG.API_BASE_URL || (() => {
  try {
    const stored = localStorage.getItem('foodqueue_api_url');
    if (stored && !stored.includes('netlify.app')) return stored;
  } catch {}
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return isLocal ? 'http://localhost:3000/api' : 'https://swynex-task-4-complete-application.onrender.com/api';
})();
const supabaseClient = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

let state = {
  selectedCategory: 'All',
  searchQuery: '',
  cart: {},
  isOfflineCatalog: false,
  isPlacingOrder: false,
  isLoadingOrder: false,
  menuItems: FOOD_ITEMS,
  categories: CATEGORIES,
  session: null,
  profile: null,
  preferences: null,
  currentOrder: {
    id: null,
    status: 'preparing',
    statusStep: 2,
    token: '#FQ-8492',
    location: 'Table 12',
    total: 377
  }
};

const STATUS_TO_STEP = {
  order_placed: 1,
  preparing: 2,
  ready_for_pickup: 3,
  completed: 4,
  cancelled: 0,
  rejected: 0
};

const NEXT_STATUS = {
  order_placed: 'preparing',
  preparing: 'ready_for_pickup',
  ready_for_pickup: 'completed'
};

function demoToken(email) {
  const payload = btoa(JSON.stringify({ sub: `demo-${email}`, email })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `demo.${payload}.signature`;
}

function authHeaders() {
  const token = state.session?.access_token || localStorage.getItem('foodqueue_demo_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || 'FoodQueue API request failed.';
    throw new Error(message);
  }
  return payload;
}

function rupee(value) {
  return `₹${Number(value || 0)}`;
}

function normalizeMenuItem(item, isOffline = false) {
  const stock = item.stockQuantity !== undefined ? Number(item.stockQuantity) : (isOffline ? null : 10);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    desc: item.desc || item.description,
    price: item.price,
    badge: item.badge,
    image: item.image || item.imageUrl,
    isAvailable: Boolean(item.isAvailable !== false && (stock === null ? item.isAvailable !== false : stock > 0)),
    stockQuantity: stock,
    isOfflinePreview: Boolean(isOffline)
  };
}

function updateOfflineUi() {
  const banner = document.getElementById('offlineNotice');
  if (banner) {
    banner.style.display = state.isOfflineCatalog ? 'flex' : 'none';
  }
}

async function loadMenuFromApi() {
  try {
    const payload = await apiRequest('/menu');
    if (!payload || !Array.isArray(payload.items)) {
      throw new Error('Invalid menu payload received from backend.');
    }
    state.isOfflineCatalog = false;
    state.menuItems = payload.items.map((item) => normalizeMenuItem(item, false));
    const categoryNames = ['All', ...(payload.categories || []).map((category) => category.name || category.label || category.id)];
    state.categories = categoryNames.map((name) => {
      const existing = CATEGORIES.find((category) => category.id === name || category.label === name);
      return existing || { id: name, label: name, icon: '<circle cx="12" cy="12" r="8"></circle>' };
    });
  } catch (error) {
    console.error('Menu load error:', error);
    state.isOfflineCatalog = true;
    state.menuItems = FOOD_ITEMS.map((item) => normalizeMenuItem(item, true));
    state.categories = CATEGORIES;
    showToast(`API: ${error.message || 'Menu service unavailable'}. Offline preview mode active.`);
  }
  updateOfflineUi();
}

async function initAuth() {
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    state.session = data.session;
  } else {
    const token = localStorage.getItem('foodqueue_demo_token');
    const profile = localStorage.getItem('foodqueue_demo_profile');
    if (token && profile) {
      state.session = { access_token: token };
      state.profile = JSON.parse(profile);
    }
  }

  if (state.session && !state.profile) {
    await loadProfile();
  }
  updateAccountUi();
}

async function ensureBackendProfile(name, email, phone) {
  const payload = await apiRequest('/auth/profile', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone })
  });
  state.profile = payload.profile;
  if (!supabaseClient) {
    localStorage.setItem('foodqueue_demo_profile', JSON.stringify(payload.profile));
  }
  return payload.profile;
}

async function loadProfile() {
  try {
    const payload = await apiRequest('/me');
    state.profile = payload.profile;
    state.preferences = payload.preferences;
  } catch {
    state.profile = null;
  }
}

function updateAccountUi() {
  const avatar = document.getElementById('avatarBtn');
  if (!avatar) return;
  const name = state.profile?.name || 'Guest';
  avatar.textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'EV';
  avatar.title = state.profile ? `Signed in as ${name}` : 'Sign in';
}

function renderCategories() {
  const container = document.getElementById('categoryContainer');
  container.innerHTML = state.categories.map(cat => {
    const isActive = state.selectedCategory === cat.id ? 'active' : '';
    return `
      <button class="category-btn ${isActive}" onclick="filterCategory('${cat.id}')">
        <div class="category-circle">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            ${cat.icon}
          </svg>
        </div>
        <span class="category-label">${cat.label}</span>
      </button>
    `;
  }).join('');
}

function renderMenu() {
  const grid = document.getElementById('foodGrid');
  const filtered = state.menuItems.filter(item => {
    const matchesCat = state.selectedCategory === 'All' || item.category === state.selectedCategory;
    const query = state.searchQuery.toLowerCase().trim();
    const matchesSearch = item.name.toLowerCase().includes(query) ||
      item.desc.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query);
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 48px 0; text-align: center; color: var(--text-muted);">
        <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 6px;">No dishes found</p>
        <p style="font-size: 0.85rem;">Try searching for "burger", "coffee", or selecting "All".</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const inCartQty = state.cart[item.id] || 0;
    const disabled = item.isAvailable ? '' : 'disabled';
    const actionMarkup = !item.isAvailable
      ? '<button class="btn-add" disabled><span>Sold Out</span></button>'
      : inCartQty > 0
        ? `
          <div class="qty-counter-group">
            <button class="qty-counter-btn" onclick="updateItemQuantity('${item.id}', -1)" title="Decrease">-</button>
            <span class="qty-counter-value">${inCartQty}</span>
            <button class="qty-counter-btn" onclick="updateItemQuantity('${item.id}', 1)" title="Increase">+</button>
          </div>
        `
        : `
          <button class="btn-add" ${disabled} onclick="updateItemQuantity('${item.id}', 1)">
            <span>Add</span>
            <span>+</span>
          </button>
        `;

    return `
      <div class="food-card">
        <div class="food-thumb-wrap">
          <img src="${item.image}" alt="${item.name}" class="food-thumb" loading="lazy" onerror="this.src='https://placehold.co/400x260/EFECE6/222624?text=${encodeURIComponent(item.name)}'" />
          ${item.badge ? `<span class="food-badge">${item.badge}</span>` : ''}
        </div>
        <div class="food-details">
          <h4 class="food-title">${item.name}</h4>
          <p class="food-desc">${item.isAvailable ? item.desc : 'Currently sold out. Please check again later.'}${state.isOfflineCatalog ? ' <span class="offline-stock-tag">(Offline Preview — stock unverified)</span>' : ''}</p>
          <div class="food-footer">
            <span class="food-price">₹${item.price}</span>
            ${actionMarkup}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function cartTotals() {
  let subtotal = 0;
  Object.keys(state.cart).forEach((id) => {
    const item = state.menuItems.find(f => f.id === id);
    if (item) subtotal += item.price * state.cart[id];
  });
  const tax = Math.round(subtotal * 0.05);
  return { subtotal, tax, total: subtotal + tax };
}

function renderCart() {
  const listEl = document.getElementById('cartItemsList');
  const countBadge = document.getElementById('cartCountBadge');
  const subtotalEl = document.getElementById('subtotalVal');
  const taxEl = document.getElementById('taxVal');
  const totalEl = document.getElementById('totalVal');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const itemIds = Object.keys(state.cart).filter(id => state.cart[id] > 0);
  const totalItemCount = itemIds.reduce((sum, id) => sum + state.cart[id], 0);
  countBadge.textContent = totalItemCount;

  if (itemIds.length === 0) {
    listEl.innerHTML = `
      <div class="cart-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        <p style="font-weight: 600; font-size: 0.95rem; color: var(--text-secondary);">Your tray is empty</p>
        <p style="font-size: 0.8rem;">Tap 'Add' on items to start your meal.</p>
      </div>
    `;
    subtotalEl.textContent = '₹0';
    taxEl.textContent = '₹0';
    totalEl.textContent = '₹0';
    checkoutBtn.disabled = true;
    const mobileCartBar = document.getElementById('mobileCartBar');
    if (mobileCartBar) mobileCartBar.classList.remove('active');
    return;
  }

  checkoutBtn.disabled = false;
  listEl.innerHTML = itemIds.map(id => {
    const item = state.menuItems.find(f => f.id === id);
    if (!item) return '';
    const qty = state.cart[id];
    return `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.name}" class="cart-thumb" onerror="this.src='https://placehold.co/100x100/EAE6DE/222624?text=Food'" />
        <div class="cart-info">
          <h5 class="cart-item-title">${item.name}</h5>
          <div class="cart-item-price">₹${item.price}</div>
        </div>
        <div class="cart-item-controls">
          <button class="cart-trash-btn" onclick="removeItemFromCart('${item.id}')" title="Remove Item">×</button>
          <div class="cart-qty-toggle">
            <button class="cart-qty-btn" onclick="updateItemQuantity('${item.id}', -1)">-</button>
            <span style="font-size: 0.85rem; font-weight: 700; min-width: 14px; text-align: center;">${qty}</span>
            <button class="cart-qty-btn" onclick="updateItemQuantity('${item.id}', 1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  const totals = cartTotals();
  subtotalEl.textContent = rupee(totals.subtotal);
  taxEl.textContent = rupee(totals.tax);
  totalEl.textContent = rupee(totals.total);

  const mobileCartBar = document.getElementById('mobileCartBar');
  const mobileCartCount = document.getElementById('mobileCartCount');
  const mobileCartTotal = document.getElementById('mobileCartTotal');
  if (mobileCartBar) {
    mobileCartBar.classList.add('active');
    if (mobileCartCount) mobileCartCount.textContent = totalItemCount;
    if (mobileCartTotal) mobileCartTotal.textContent = rupee(totals.total);
  }
}

function updateItemQuantity(foodId, change) {
  const item = state.menuItems.find((entry) => entry.id === foodId);
  if (item && !item.isAvailable) return showToast('This item is currently sold out.');
  const current = state.cart[foodId] || 0;
  const updated = current + change;
  if (updated <= 0) delete state.cart[foodId];
  else state.cart[foodId] = updated;
  renderMenu();
  renderCart();
}

function removeItemFromCart(foodId) {
  delete state.cart[foodId];
  renderMenu();
  renderCart();
  showToast('Item removed from cart');
}

function filterCategory(catId) {
  state.selectedCategory = catId;
  document.getElementById('menuSectionTitle').textContent = catId === 'All' ? 'Popular Today' : `${catId} Specials`;
  renderCategories();
  renderMenu();
}

function handleSearch(term) {
  state.searchQuery = term;
  renderMenu();
}

function switchNav(buttonEl, view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  buttonEl.classList.add('active');
  if (view === 'menu' || view === 'home') {
    state.selectedCategory = 'All';
    renderCategories();
    renderMenu();
  }
}

function openCheckoutModal() {
  const itemIds = Object.keys(state.cart).filter(id => state.cart[id] > 0);
  if (itemIds.length === 0) return showToast('Your cart is empty');

  const offlineAlert = document.getElementById('checkoutOfflineAlert');
  const placeOrderBtn = document.getElementById('placeOrderBtn');
  const placeOrderBtnText = document.getElementById('placeOrderBtnText');
  if (state.isOfflineCatalog) {
    if (offlineAlert) offlineAlert.style.display = 'flex';
    if (placeOrderBtn) {
      placeOrderBtn.disabled = true;
      if (placeOrderBtnText) placeOrderBtnText.textContent = 'Live Ordering Offline';
    }
  } else {
    if (offlineAlert) offlineAlert.style.display = 'none';
    if (placeOrderBtn) {
      placeOrderBtn.disabled = false;
      if (placeOrderBtnText) placeOrderBtnText.textContent = 'Place Order Now';
    }
  }

  let subtotal = 0;
  document.getElementById('modalItemsReview').innerHTML = itemIds.map(id => {
    const item = state.menuItems.find(f => f.id === id);
    const qty = state.cart[id];
    const cost = item.price * qty;
    subtotal += cost;
    return `<div class="mini-item-row"><span>${item.name} × ${qty}</span><strong>₹${cost}</strong></div>`;
  }).join('');
  document.getElementById('modalTotalAmount').textContent = rupee(subtotal + Math.round(subtotal * 0.05));
  document.getElementById('checkoutModal').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function applyOrderFromApi(order) {
  if (!order) return;
  state.currentOrder = {
    id: order.id,
    token: order.token,
    customerName: order.customerName,
    location: order.pickupSpot,
    pickupTime: order.pickupTime,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    status: order.status,
    statusStep: (order.status in STATUS_TO_STEP) ? STATUS_TO_STEP[order.status] : 1
  };
}

function setPlaceOrderLoading(isLoading) {
  state.isPlacingOrder = isLoading;
  const button = document.getElementById('placeOrderBtn');
  const label = document.getElementById('placeOrderBtnText');
  if (!button || !label) return;
  button.disabled = isLoading;
  label.textContent = isLoading ? 'Placing Order...' : 'Place Order Now';
}

async function handlePlaceOrder(event) {
  event.preventDefault();
  if (state.isPlacingOrder) return;
  if (state.isOfflineCatalog) {
    showToast('Cannot place order: FoodQueue kitchen backend is offline. Real orders require a live connection.');
    return;
  }
  const items = Object.keys(state.cart).filter(id => state.cart[id] > 0).map(id => ({ menuItemId: id, quantity: state.cart[id] }));
  if (items.length === 0) return showToast('Your cart is empty');

  setPlaceOrderLoading(true);
  try {
    const { order } = await apiRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: document.getElementById('custName').value,
        phone: document.getElementById('custPhone').value,
        pickupSpot: document.getElementById('pickupLocation').value,
        pickupTime: document.getElementById('pickupTime').value,
        paymentMethod: document.getElementById('paymentMethod').value,
        notes: document.getElementById('orderNotes').value,
        items
      })
    });

    applyOrderFromApi(order);
    document.getElementById('currentTableLabel').textContent = order.pickupSpot.split(' ').slice(0, 2).join(' ');
    closeModal('checkoutModal');
    document.getElementById('confirmToken').textContent = order.token;
    document.getElementById('confirmPickupSpot').textContent = order.pickupSpot;
    document.getElementById('confirmAmount').textContent = rupee(order.total);
    document.getElementById('confirmModal').classList.add('active');
    state.cart = {};
    await loadMenuFromApi();
    renderMenu();
    renderCart();
    showToast(order.paymentStatus === 'paid' ? 'Order confirmed!' : `Order confirmed. ${order.paymentMethod.toUpperCase()} payment is not completed in this demo.`);
  } catch (error) {
    showToast(error.message || 'Unable to place order. Please try again.');
  } finally {
    setPlaceOrderLoading(false);
  }
}

function openTrackingFromConfirmation() {
  closeModal('confirmModal');
  openActiveTrackingModal();
}

async function openActiveTrackingModal(orderId = state.currentOrder.id) {
  const statusMessage = document.getElementById('trackingStatusMessage');
  document.getElementById('trackTokenBadge').textContent = state.currentOrder.token || '#FQ-8492';
  document.getElementById('trackingModal').classList.add('active');
  updateTrackingTimelineUI(state.currentOrder.statusStep);
  if (!orderId) {
    statusMessage.textContent = 'No saved backend order yet. Place an order to load live tracking.';
    statusMessage.style.color = '';
    return;
  }
  statusMessage.textContent = 'Loading latest order status...';
  statusMessage.style.color = '';
  try {
    const { order } = await apiRequest(`/orders/${orderId}`);
    applyOrderFromApi(order);
    document.getElementById('trackTokenBadge').textContent = order.token;
    updateTrackingTimelineUI(state.currentOrder.statusStep);
    if (order.status === 'cancelled' || order.status === 'rejected') {
      statusMessage.textContent = `Order ${order.status.toUpperCase()}: This order was ${order.status}. Payment: ${order.paymentStatus}.`;
      statusMessage.style.color = '#dc2626';
    } else {
      statusMessage.textContent = `Latest status: ${order.status.replaceAll('_', ' ')} • Payment: ${order.paymentStatus}`;
      statusMessage.style.color = '';
    }
  } catch (error) {
    statusMessage.textContent = error.message || 'Unable to load the latest order status.';
    statusMessage.style.color = '';
  }
}

function updateTrackingTimelineUI(currentStep) {
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step${i}`);
    if (!stepEl) continue;
    stepEl.classList.remove('completed', 'active');
    const marker = stepEl.querySelector('.step-marker');
    if (currentStep === 0) {
      if (marker) marker.textContent = '✕';
    } else if (i < currentStep) {
      stepEl.classList.add('completed');
      if (marker) marker.textContent = '✓';
    } else if (i === currentStep) {
      stepEl.classList.add('active');
      if (marker) marker.textContent = i;
    } else {
      if (marker) marker.textContent = i;
    }
  }
}

async function advanceOrderStatus() {
  showToast('Kitchen status is now managed from the owner dashboard.');
}

function openAccountModal() {
  renderAccountPanel();
  document.getElementById('accountModal').classList.add('active');
}

function renderAccountPanel() {
  const panel = document.getElementById('accountPanel');
  if (state.profile) {
    panel.innerHTML = `
      <div class="order-mini-summary">
        <div class="mini-item-row"><span>Name</span><strong>${state.profile.name}</strong></div>
        <div class="mini-item-row"><span>Email</span><strong>${state.profile.email || 'Not set'}</strong></div>
        <div class="mini-item-row"><span>Role</span><strong>${state.profile.role}</strong></div>
      </div>
      ${state.profile.role === 'owner' ? '<button class="btn-checkout" onclick="window.location.href=\'owner.html\'"><span>Open Owner Dashboard</span></button>' : ''}
      <button class="btn-add" style="margin-top: 12px;" onclick="logout()">Logout</button>
    `;
    return;
  }
  panel.innerHTML = `
    <form onsubmit="loginOrRegister(event)">
      <div class="form-group"><label class="form-label" for="authName">Name</label><input id="authName" class="form-control" value="Ethan Vance" required /></div>
      <div class="form-group"><label class="form-label" for="authEmail">Email</label><input id="authEmail" type="email" class="form-control" value="student@foodqueue.local" required /></div>
      <div class="form-group"><label class="form-label" for="authPassword">Password</label><input id="authPassword" type="password" class="form-control" value="foodqueue-demo" required /></div>
      <button class="btn-checkout" type="submit"><span>Register / Login</span></button>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-top:10px;">When Supabase config is present, this uses Supabase Auth. Without config, local demo auth is used.</p>
    </form>
  `;
}

async function loginOrRegister(event) {
  event.preventDefault();
  const name = document.getElementById('authName').value;
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  try {
    if (supabaseClient) {
      let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        ({ data, error } = await supabaseClient.auth.signUp({ email, password }));
      }
      if (error) throw error;
      state.session = data.session || (await supabaseClient.auth.getSession()).data.session;
    } else {
      const token = demoToken(email);
      localStorage.setItem('foodqueue_demo_token', token);
      state.session = { access_token: token };
    }
    await ensureBackendProfile(name, email);
    updateAccountUi();
    renderAccountPanel();
    showToast('Signed in successfully');
  } catch (error) {
    showToast(error.message || 'Unable to sign in.');
  }
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  localStorage.removeItem('foodqueue_demo_token');
  localStorage.removeItem('foodqueue_demo_profile');
  state.session = null;
  state.profile = null;
  updateAccountUi();
  renderAccountPanel();
  showToast('Logged out');
}

async function openOrdersModal() {
  document.getElementById('ordersModal').classList.add('active');
  const list = document.getElementById('ordersHistoryList');
  if (!state.profile) {
    list.innerHTML = '<p class="modal-subtitle">Please sign in to view private order history.</p>';
    return;
  }
  list.innerHTML = '<p class="modal-subtitle">Loading orders...</p>';
  try {
    const { orders } = await apiRequest('/me/orders');
    if (!orders.length) {
      list.innerHTML = '<div class="cart-empty-state"><p>No orders yet</p><p>Place an order and it will appear here.</p></div>';
      return;
    }
    list.innerHTML = orders.map(order => `
      <div class="order-mini-summary">
        <div class="mini-item-row"><span>${order.token}</span><strong>${rupee(order.total)}</strong></div>
        <div class="mini-item-row"><span>Status</span><strong>${order.status.replaceAll('_', ' ')}</strong></div>
        <div class="mini-item-row"><span>Payment</span><strong>${order.paymentStatus}</strong></div>
        <button class="btn-add" onclick="closeModal('ordersModal'); openActiveTrackingModal(${order.id})">Track</button>
      </div>
    `).join('');
  } catch (error) {
    list.innerHTML = `<p class="modal-subtitle">${error.message}</p>`;
  }
}

async function openOffersModal() {
  document.getElementById('offersModal').classList.add('active');
  const list = document.getElementById('offersList');
  list.innerHTML = '<p class="modal-subtitle">Loading offers...</p>';
  try {
    const { offers } = await apiRequest('/offers');
    list.innerHTML = offers.length ? offers.map(offer => `
      <div class="order-mini-summary">
        <div class="mini-summary-header">${offer.title}</div>
        <p style="font-size:0.86rem;color:var(--text-secondary);">${offer.description}</p>
      </div>
    `).join('') : '<p class="modal-subtitle">No active offers right now.</p>';
  } catch (error) {
    list.innerHTML = `<p class="modal-subtitle">${error.message}</p>`;
  }
}

function openFeedbackModal() {
  if (!state.profile) return openAccountModal();
  document.getElementById('feedbackModal').classList.add('active');
}

async function submitFeedback(event) {
  event.preventDefault();
  try {
    await apiRequest('/feedback', {
      method: 'POST',
      body: JSON.stringify({
        orderId: state.currentOrder.id,
        rating: Number(document.getElementById('feedbackRating').value),
        comment: document.getElementById('feedbackComment').value
      })
    });
    closeModal('feedbackModal');
    showToast('Feedback submitted. Thank you!');
  } catch (error) {
    showToast(error.message);
  }
}

function openSettingsModal() {
  if (!state.profile) return openAccountModal();
  document.getElementById('settingsName').value = state.profile.name || '';
  document.getElementById('settingsPhone').value = state.profile.phone || '';
  document.getElementById('dietaryPreference').value = state.preferences?.dietary_preference || '';
  document.getElementById('spicePreference').value = state.preferences?.spice_preference || '';
  document.getElementById('settingsModal').classList.add('active');
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const payload = await apiRequest('/me', {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('settingsName').value,
        phone: document.getElementById('settingsPhone').value,
        dietaryPreference: document.getElementById('dietaryPreference').value,
        spicePreference: document.getElementById('spicePreference').value
      })
    });
    state.profile = payload.profile;
    state.preferences = payload.preferences;
    updateAccountUi();
    closeModal('settingsModal');
    showToast('Settings saved');
  } catch (error) {
    showToast(error.message);
  }
}

function openNotifications() {
  if (state.currentOrder.id) {
    showToast(`Latest order ${state.currentOrder.token}: ${state.currentOrder.status.replaceAll('_', ' ')}`);
  } else {
    showToast('No order notifications yet');
  }
}

let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2600);
}

window.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  await loadMenuFromApi();
  renderCategories();
  renderMenu();
  renderCart();
});

Object.assign(window, {
  advanceOrderStatus,
  closeModal,
  filterCategory,
  handlePlaceOrder,
  handleSearch,
  loginOrRegister,
  logout,
  openAccountModal,
  openActiveTrackingModal,
  openCheckoutModal,
  openFeedbackModal,
  openNotifications,
  openOffersModal,
  openOrdersModal,
  openSettingsModal,
  openTrackingFromConfirmation,
  removeItemFromCart,
  saveSettings,
  submitFeedback,
  switchNav,
  updateItemQuantity
});
