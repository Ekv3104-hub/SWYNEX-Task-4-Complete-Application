const OWNER_CONFIG = window.FOODQUEUE_CONFIG || {};
const OWNER_API = OWNER_CONFIG.API_BASE_URL || (() => {
  try {
    const stored = localStorage.getItem('foodqueue_api_url');
    if (stored && !stored.includes('netlify.app')) return stored;
  } catch {}
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return isLocal ? 'http://localhost:3000/api' : 'https://swynex-task-4-complete-application.onrender.com/api';
})();
const ownerSupabase = OWNER_CONFIG.SUPABASE_URL && OWNER_CONFIG.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(OWNER_CONFIG.SUPABASE_URL, OWNER_CONFIG.SUPABASE_ANON_KEY)
  : null;

let ownerState = {
  session: null,
  summary: null,
  menu: [],
  categories: [],
  canteen: null
};

function ownerDemoToken() {
  const payload = btoa(JSON.stringify({ sub: 'demo-owner', email: 'owner@foodqueue.local' })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `demo.${payload}.signature`;
}

function ownerHeaders() {
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );
  let token = ownerState.session?.access_token;
  if (!token && isLocal) {
    token = localStorage.getItem('foodqueue_demo_owner_token') || ownerDemoToken();
    localStorage.setItem('foodqueue_demo_owner_token', token);
  }
  if (token && token.startsWith('demo.') && !isLocal) {
    token = null;
  }
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json'
  };
}

async function ownerApi(path, options = {}) {
  const response = await fetch(`${OWNER_API}${path}`, {
    headers: { ...ownerHeaders(), ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || 'Owner API request failed.');
  return payload;
}

function ownerToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2600);
}

function showOwnerView(view, button) {
  ['overview', 'menu', 'orders', 'settings'].forEach((name) => {
    document.getElementById(`${name}View`).style.display = name === view ? '' : 'none';
  });
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  if (button) button.classList.add('active');
}

async function initOwnerAuth() {
  if (ownerSupabase) {
    const { data } = await ownerSupabase.auth.getSession();
    ownerState.session = data.session;
    if (!ownerState.session) {
      ownerToast('Sign in as an owner in Supabase before using the dashboard.');
    }
  } else {
    ownerState.session = { access_token: ownerDemoToken() };
  }
}

async function loadOwnerDashboard() {
  const [summary, menu, canteen] = await Promise.all([
    ownerApi('/owner/summary'),
    ownerApi('/owner/menu'),
    ownerApi('/owner/canteen')
  ]);
  ownerState.summary = summary;
  ownerState.menu = menu.items;
  ownerState.categories = menu.categories;
  ownerState.canteen = canteen.canteen;
  document.getElementById('ownerSubtitle').textContent = `${canteen.canteen.name} • ${summary.totals.totalOrders} tracked orders`;
  renderOwnerOverview();
  renderOwnerMenu();
  renderOwnerOrders();
  renderOwnerSettings();
}

function metricCard(label, value) {
  return `<div class="food-card"><div class="food-details"><p class="food-desc">${label}</p><h4 class="food-title" style="font-size:1.4rem;">${value}</h4></div></div>`;
}

function renderOwnerOverview() {
  const totals = ownerState.summary.totals;
  document.getElementById('ownerMetrics').innerHTML = [
    metricCard('Total Orders', totals.totalOrders),
    metricCard('Gross Sales', `₹${totals.grossSales}`),
    metricCard('Paid Sales', `₹${totals.paidSales}`),
    metricCard('Unpaid / Pending', `₹${totals.unpaidSales}`)
  ].join('');
  document.getElementById('bestSellers').innerHTML = ownerState.summary.bestSellers.map((item) =>
    metricCard(item.name, `${item.quantity} sold • ₹${item.sales}`)
  ).join('') || '<p class="modal-subtitle">No sales yet.</p>';
  document.getElementById('stockAlerts').innerHTML = ownerState.summary.lowStock.map((item) => `
    <div class="order-mini-summary">
      <div class="mini-item-row"><span>${item.name}</span><strong>${item.stock_quantity} left</strong></div>
      <p class="modal-subtitle">Low-stock threshold: ${item.low_stock_threshold}</p>
    </div>
  `).join('') || '<p class="modal-subtitle">No low-stock alerts.</p>';
}

function renderOwnerMenu() {
  document.getElementById('ownerMenuGrid').innerHTML = ownerState.menu.map((item) => `
    <div class="food-card">
      <div class="food-thumb-wrap"><img class="food-thumb" src="${item.imageUrl}" alt="${item.name}" /></div>
      <div class="food-details">
        <h4 class="food-title">${item.name}</h4>
        <p class="food-desc">${item.category} • ${item.isAvailable ? 'Available' : 'Sold out'} • Stock ${item.stockQuantity}</p>
        <div class="food-footer">
          <span class="food-price">₹${item.price}</span>
          <button class="btn-add" onclick="openMenuEditor('${item.id}')">Edit</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderOwnerOrders() {
  document.getElementById('ownerOrdersList').innerHTML = ownerState.summary.recentOrders.map((order) => {
    const isCompleted = order.status === 'completed';
    const isCancelled = order.status === 'cancelled' || order.status === 'rejected';
    const isCashUnpaid = order.paymentMethod === 'cash' && order.paymentStatus === 'unpaid';

    let actionButtons = '';
    if (isCashUnpaid) {
      actionButtons += `<button class="btn-add" style="margin-right:6px;" onclick="markOwnerOrderPaid(${order.id})">✓ Verify & Mark Paid (Cash)</button>`;
    }
    if (!isCompleted && !isCancelled) {
      actionButtons += `<button class="btn-add" style="margin-right:6px;" onclick="advanceOwnerOrder(${order.id}, '${order.status}')">Advance Status</button>`;
      actionButtons += `<button class="btn-add" style="color:#E15241;" onclick="cancelOwnerOrder(${order.id})">Cancel / Reject</button>`;
    } else if (isCompleted) {
      actionButtons += '<span style="font-size:0.82rem; color:#2B8A3E; font-weight:600;">✓ Completed</span>';
    } else if (isCancelled) {
      actionButtons += `<span style="font-size:0.82rem; color:#E15241; font-weight:600;">✕ ${order.status.toUpperCase()}</span>`;
    }

    return `
      <div class="order-mini-summary">
        <div class="mini-item-row">
          <span>${order.token} • ${order.customerName}</span>
          <strong>₹${order.total}</strong>
        </div>
        <div class="mini-item-row">
          <span>Order Status</span>
          <strong>${order.status.replaceAll('_', ' ')}</strong>
        </div>
        <div class="mini-item-row">
          <span>Payment</span>
          <strong>${order.paymentMethod.toUpperCase()} (${order.paymentStatus})</strong>
        </div>
        <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('') || '<p class="modal-subtitle">No incoming orders yet.</p>';
}

function renderOwnerSettings() {
  const canteen = ownerState.canteen;
  document.getElementById('canteenName').value = canteen.name || '';
  document.getElementById('canteenPhone').value = canteen.contact_phone || '';
  document.getElementById('canteenDescription').value = canteen.description || '';
  document.getElementById('openingWeekday').value = canteen.openingHours?.mon_fri || '';
  document.getElementById('pickupLocations').value = (canteen.pickupLocations || []).join(', ');
}

function openMenuEditor(id) {
  const item = ownerState.menu.find((entry) => entry.id === id) || {};
  document.getElementById('menuItemId').value = item.id || '';
  document.getElementById('menuName').value = item.name || '';
  document.getElementById('menuCategory').value = item.category || 'Burgers';
  document.getElementById('menuDescription').value = item.description || item.desc || '';
  document.getElementById('menuImage').value = item.imageUrl || '';
  document.getElementById('menuPrice').value = item.price || 0;
  document.getElementById('menuStock').value = item.stockQuantity || 0;
  document.getElementById('menuLowStock').value = item.lowStockThreshold || 5;
  document.getElementById('menuAvailable').value = item.isAvailable === false ? 'false' : 'true';
  document.getElementById('menuEditorModal').classList.add('active');
}

function closeOwnerModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function saveMenuItem(event) {
  event.preventDefault();
  const id = document.getElementById('menuItemId').value;
  const payload = {
    name: document.getElementById('menuName').value,
    category: document.getElementById('menuCategory').value,
    description: document.getElementById('menuDescription').value,
    imageUrl: document.getElementById('menuImage').value,
    price: Number(document.getElementById('menuPrice').value),
    stockQuantity: Number(document.getElementById('menuStock').value),
    lowStockThreshold: Number(document.getElementById('menuLowStock').value),
    isAvailable: document.getElementById('menuAvailable').value === 'true'
  };
  await ownerApi(id ? `/owner/menu/${id}` : '/owner/menu', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload)
  });
  closeOwnerModal('menuEditorModal');
  await loadOwnerDashboard();
  ownerToast('Menu item saved');
}

async function advanceOwnerOrder(id, status) {
  const next = { order_placed: 'preparing', preparing: 'ready_for_pickup', ready_for_pickup: 'completed' }[status];
  if (!next) return ownerToast('Order has no further standard stage.');
  await ownerApi(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
  await loadOwnerDashboard();
  ownerToast(`Order moved to ${next.replaceAll('_', ' ')}`);
}

async function markOwnerOrderPaid(id) {
  try {
    await ownerApi(`/orders/${id}/payment`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentStatus: 'paid' })
    });
    await loadOwnerDashboard();
    ownerToast('Cash payment verified & marked as paid.');
  } catch (error) {
    ownerToast(error.message);
  }
}

async function cancelOwnerOrder(id) {
  if (!confirm('Are you sure you want to cancel/reject this order? Reserved items will be returned to stock.')) return;
  try {
    await ownerApi(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' })
    });
    await loadOwnerDashboard();
    ownerToast('Order cancelled and inventory restored.');
  } catch (error) {
    ownerToast(error.message);
  }
}

async function saveCanteenSettings(event) {
  event.preventDefault();
  await ownerApi('/owner/canteen', {
    method: 'PUT',
    body: JSON.stringify({
      name: document.getElementById('canteenName').value,
      contactPhone: document.getElementById('canteenPhone').value,
      description: document.getElementById('canteenDescription').value,
      openingHours: { mon_fri: document.getElementById('openingWeekday').value },
      pickupLocations: document.getElementById('pickupLocations').value.split(',').map((item) => item.trim()).filter(Boolean)
    })
  });
  await loadOwnerDashboard();
  ownerToast('Canteen settings saved');
}

async function ownerLogout() {
  if (ownerSupabase) await ownerSupabase.auth.signOut();
  localStorage.removeItem('foodqueue_demo_owner_token');
  window.location.href = 'index.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await initOwnerAuth();
    await loadOwnerDashboard();
    setInterval(async () => {
      try {
        await loadOwnerDashboard();
      } catch (_) {}
    }, 20000);
  } catch (error) {
    ownerToast(error.message);
  }
});

Object.assign(window, {
  advanceOwnerOrder,
  cancelOwnerOrder,
  closeOwnerModal,
  markOwnerOrderPaid,
  openMenuEditor,
  ownerLogout,
  saveCanteenSettings,
  saveMenuItem,
  showOwnerView
});
