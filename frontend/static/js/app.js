/* =====================================================================
   PharmaVibe - Core Client SPA Logic
   ===================================================================== */

// Global Application State
const state = {
    token: localStorage.getItem('token') || null,
    user: null,
    cart: null,
    categories: []
};

// =====================================================================
// API Utility Wrapper
// =====================================================================
async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `/api/${endpoint}`;
    
    // Attach authorization header if token exists
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    const config = {
        ...options,
        headers
    };
    
    try {
        const response = await fetch(url, config);
        
        // Handle unauthorized session expiration
        if (response.status === 401 && state.token) {
            state.token = null;
            state.user = null;
            localStorage.removeItem('token');
            updateAuthUI();
            showToast('Session expired. Please log in again.', 'warning');
            openAuthModal('login');
            navigateTo('/');
            return { error: 'Unauthorized' };
        }
        
        const data = await response.json();
        if (!response.ok) {
            return { error: data.error || 'Something went wrong' };
        }
        return data;
    } catch (err) {
        console.error('API Fetch Error:', err);
        return { error: 'Failed to communicate with server.' };
    }
}

// =====================================================================
// Toast Alerts System
// =====================================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div class="toast-message">${message}</div>
    `;
    
    container.appendChild(toast);
    
    // Fade out and remove toast
    setTimeout(() => {
        toast.style.animation = 'fadeIn 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// =====================================================================
// SPA Client Router
// =====================================================================
const routes = {
    '/': renderHome,
    '/medicines': renderMedicines,
    '/cart': renderCart,
    '/orders': renderOrders,
    '/profile': renderProfile,
    '/admin/dashboard': renderAdminDashboard,
    '/admin/medicines': renderAdminInventory,
    '/admin/categories': renderAdminCategories,
    '/admin/users': renderAdminUsers,
    '/admin/orders': renderAdminOrders
};

function navigateTo(url) {
    window.history.pushState(null, null, url);
    router();
}

async function router() {
    const path = window.location.pathname;
    const queryParams = new URLSearchParams(window.location.search);
    
    // Fetch categories if not loaded
    if (state.categories.length === 0) {
        const cats = await apiFetch('categories');
        if (Array.isArray(cats)) {
            state.categories = cats;
            updateCategoryDropdowns();
        }
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Close mobile navigation menu if open
    document.getElementById('app-navigation').classList.remove('show');

    // Route guards
    const isAdminRoute = path.startsWith('/admin');
    const isCustomerRoute = ['/cart', '/orders', '/profile'].includes(path);

    if (isAdminRoute) {
        if (!state.user || state.user.role !== 'admin') {
            showToast('Access Denied. Administrator privileges required.', 'danger');
            navigateTo('/');
            return;
        }
    }

    if (isCustomerRoute) {
        if (!state.user) {
            showToast('Please sign in to access this page.', 'warning');
            openAuthModal('login');
            navigateTo('/');
            return;
        }
    }

    // Render View
    const renderFn = routes[path] || renderHome;
    
    // Highlight Active Link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        const href = link.getAttribute('href');
        if (href === path || (href !== '/' && path.startsWith(href))) {
            link.classList.add('active');
        }
    });

    const root = document.getElementById('app-root');
    root.innerHTML = `
        <div class="loader-container">
            <div class="spinner"></div>
            <p>Loading view...</p>
        </div>
    `;

    try {
        await renderFn(queryParams);
    } catch (error) {
        console.error('Render Error:', error);
        root.innerHTML = `
            <div class="container text-center">
                <h2><i class="fa-solid fa-triangle-exclamation text-danger"></i> Render Error</h2>
                <p>An unexpected error occurred while loading this view.</p>
                <button class="btn btn-primary" onclick="navigateTo('/')">Go Home</button>
            </div>
        `;
    }
}

// Link click interceptor
document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') && link.getAttribute('href').startsWith('/')) {
        const target = link.getAttribute('target');
        if (target !== '_blank') {
            e.preventDefault();
            navigateTo(link.getAttribute('href'));
        }
    }
});

window.addEventListener('popstate', router);

// =====================================================================
// AUTHENTICATION UI & MODALS
// =====================================================================
function updateAuthUI() {
    const authSection = document.getElementById('auth-section');
    const userProfileMenu = document.getElementById('user-profile-menu');
    const customerLinks = document.querySelectorAll('.customer-only');
    const adminLinks = document.querySelectorAll('.admin-only');

    if (state.user) {
        authSection.style.display = 'none';
        userProfileMenu.style.display = 'block';
        
        // Set display details
        document.getElementById('user-fullname').textContent = state.user.name;
        // Generate initials
        const initials = state.user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('user-avatar-initials').textContent = initials;

        if (state.user.role === 'admin') {
            customerLinks.forEach(el => el.style.display = 'none');
            adminLinks.forEach(el => el.style.display = 'block');
        } else {
            customerLinks.forEach(el => el.style.display = 'block');
            adminLinks.forEach(el => el.style.display = 'none');
            // Fetch cart count
            fetchCartCount();
        }
    } else {
        authSection.style.display = 'flex';
        userProfileMenu.style.display = 'none';
        customerLinks.forEach(el => el.style.display = 'none');
        adminLinks.forEach(el => el.style.display = 'none');
        document.getElementById('cart-item-count').style.display = 'none';
    }
}

async function fetchCartCount() {
    if (!state.user || state.user.role === 'admin') return;
    const cart = await apiFetch('cart');
    if (cart && Array.isArray(cart.items)) {
        state.cart = cart;
        const totalQty = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        const badge = document.getElementById('cart-item-count');
        if (totalQty > 0) {
            badge.textContent = totalQty;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function openAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const title = document.getElementById('auth-modal-title');

    modal.style.display = 'flex';

    if (mode === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        title.textContent = 'Log In to PharmaVibe';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.textContent = 'Create PharmaVibe Account';
    }
}

function closeAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
}

// Initialise Authorization state from JWT on page load
async function initializeAuth() {
    if (state.token) {
        const user = await apiFetch('profile');
        if (user && !user.error) {
            state.user = user;
        } else {
            state.token = null;
            localStorage.removeItem('token');
        }
    }
    updateAuthUI();
    router();
}

// =====================================================================
// DYNAMIC VIEW RENDERERS
// =====================================================================

// --- 1. HOME VIEW ---
async function renderHome() {
    const root = document.getElementById('app-root');
    
    // Fetch products
    const medicines = await apiFetch('medicines');
    const medsList = Array.isArray(medicines) ? medicines : [];
    
    // Take first 4 for featured, next 4 for best sellers
    const featuredMeds = medsList.slice(0, 4);
    const bestSellers = medsList.slice(4, 8);

    let categoriesHTML = state.categories.slice(0, 6).map((cat, index) => {
        // Match icon
        let icon = 'fa-prescription-bottle-medical';
        if (cat.categoryName.includes('Pain')) icon = 'fa-hand-holding-medical';
        if (cat.categoryName.includes('Diab')) icon = 'fa-droplet';
        if (cat.categoryName.includes('Vitamin')) icon = 'fa-shield-heart';
        if (cat.categoryName.includes('Skin')) icon = 'fa-spa';
        if (cat.categoryName.includes('Aller')) icon = 'fa-wind';
        if (cat.categoryName.includes('Baby')) icon = 'fa-baby';

        return `
            <div class="category-card" onclick="navigateTo('/medicines?category=${encodeURIComponent(cat.categoryName)}')">
                <i class="fa-solid ${icon} category-card-icon"></i>
                <h3>${cat.categoryName}</h3>
            </div>
        `;
    }).join('');

    root.innerHTML = `
        <div class="container">
            <!-- Hero Banner -->
            <div class="hero-banner">
                <div class="hero-content">
                    <span class="hero-tagline">24/7 Digital Pharmacy</span>
                    <h1 class="hero-title">Your Health, Delivered Smartly.</h1>
                    <p class="hero-description">Browse over thousands of verified medicines, supplements, and skin care products. Fast shipping directly to your doorstep.</p>
                    <div class="hero-actions">
                        <a href="/medicines" class="btn btn-primary"><i class="fa-solid fa-magnifying-glass"></i> Browse Catalog</a>
                        <a href="#featured-section" class="btn btn-outline" style="color:white;border-color:rgba(255,255,255,0.4)">View Offers</a>
                    </div>
                </div>
                <div class="hero-bg-shapes">
                    <div class="hero-shape-1"></div>
                    <div class="hero-shape-2"></div>
                </div>
            </div>

            <!-- Categories Section -->
            <section class="home-categories-section">
                <h2 class="section-title">Shop by Category</h2>
                <div class="home-categories-grid">
                    ${categoriesHTML}
                </div>
            </section>

            <!-- Featured Medicines Section -->
            <section class="home-medicines-section" id="featured-section">
                <h2 class="section-title">Featured Health Essentials</h2>
                <div class="featured-grid">
                    ${featuredMeds.map(med => renderMedicineCard(med)).join('')}
                </div>
            </section>

            <!-- Special Offer Banner -->
            <div class="special-offers-banner">
                <div class="offer-content">
                    <span class="offer-badge">Limited Time Offer</span>
                    <h3 class="offer-title">Save Up to 20% on Vitamins & Immunity Boosters</h3>
                    <p class="offer-desc">Prioritize your immunity today. Stock up on Vitamin C, Zinc, and daily multivitamins from top-tier brands.</p>
                </div>
                <a href="/medicines?category=Vitamin Supplements" class="btn btn-primary">Shop Now</a>
            </div>

            <!-- Best Sellers Section -->
            <section class="home-medicines-section">
                <h2 class="section-title">Best Selling Products</h2>
                <div class="featured-grid">
                    ${bestSellers.map(med => renderMedicineCard(med)).join('')}
                </div>
            </section>
        </div>
    `;
}

function renderMedicineCard(med) {
    const isOutOfStock = med.stock <= 0;
    const isLowStock = med.stock > 0 && med.stock < 10;
    
    let badgeHTML = '';
    if (isOutOfStock) {
        badgeHTML = '<span class="med-card-badge low-stock">OUT OF STOCK</span>';
    } else if (isLowStock) {
        badgeHTML = `<span class="med-card-badge low-stock">ONLY ${med.stock} LEFT</span>`;
    } else {
        badgeHTML = '<span class="med-card-badge in-stock">IN STOCK</span>';
    }

    const defaultImg = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60";
    const imageSrc = med.image || defaultImg;

    return `
        <div class="medicine-card">
            <div class="med-card-img-wrapper">
                <img src="${imageSrc}" alt="${med.medicineName}" class="med-card-img" onerror="this.src='${defaultImg}'">
                ${badgeHTML}
                <span class="med-card-category">${med.category}</span>
            </div>
            <div class="med-card-body">
                <span class="med-card-brand">${med.brand}</span>
                <h3 class="med-card-name">${med.medicineName}</h3>
                <p class="med-card-desc">${med.description || 'No description available for this medicine.'}</p>
                <div class="med-card-footer">
                    <span class="med-card-price">$${parseFloat(med.price).toFixed(2)}</span>
                    <button class="btn btn-primary btn-sm" onclick="openProductDetails('${med._id}')">
                        <i class="fa-solid fa-circle-info"></i> Details
                    </button>
                </div>
            </div>
        </div>
    `;
}

// --- 2. MEDICINES CATALOG VIEW ---
async function renderMedicines(queryParams) {
    const root = document.getElementById('app-root');
    const searchVal = queryParams.get('q') || '';
    const catVal = queryParams.get('category') || '';
    const minVal = queryParams.get('minPrice') || '';
    const maxVal = queryParams.get('maxPrice') || '';
    const sortVal = queryParams.get('sort') || 'medicineName';
    const orderVal = queryParams.get('order') || 'asc';

    // Fetch catalog list based on active parameters
    const params = new URLSearchParams();
    if (searchVal) params.set('q', searchVal);
    if (catVal) params.set('category', catVal);
    if (minVal) params.set('minPrice', minVal);
    if (maxVal) params.set('maxPrice', maxVal);
    if (sortVal) params.set('sort', sortVal);
    if (orderVal) params.set('order', orderVal);

    const medicines = await apiFetch(`medicines?${params.toString()}`);
    const medsList = Array.isArray(medicines) ? medicines : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Browse Medicines</h1>
                    <p class="page-subtitle">Search and filter high-quality medicines and supplements.</p>
                </div>
            </div>

            <div class="catalog-layout">
                <!-- Sidebar Filters -->
                <aside class="filter-sidebar">
                    <div class="filter-group">
                        <h3 class="filter-group-title"><i class="fa-solid fa-filter"></i> Category</h3>
                        <select id="filter-category" class="filter-select">
                            <option value="">All Categories</option>
                            ${state.categories.map(c => `<option value="${c.categoryName}" ${c.categoryName === catVal ? 'selected' : ''}>${c.categoryName}</option>`).join('')}
                        </select>
                    </div>

                    <div class="filter-group">
                        <h3 class="filter-group-title"><i class="fa-solid fa-dollar-sign"></i> Price Range</h3>
                        <div class="price-inputs">
                            <input type="number" id="filter-min-price" class="price-input" placeholder="Min" value="${minVal}">
                            <span>-</span>
                            <input type="number" id="filter-max-price" class="price-input" placeholder="Max" value="${maxVal}">
                        </div>
                    </div>

                    <button id="btn-apply-filters" class="btn btn-primary btn-block"><i class="fa-solid fa-circle-check"></i> Apply Filters</button>
                    <button id="btn-reset-filters" class="btn btn-outline btn-block" style="margin-top:0.75rem"><i class="fa-solid fa-arrows-rotate"></i> Reset</button>
                </aside>

                <!-- Catalog Main Content -->
                <section class="catalog-main">
                    <div class="search-sort-bar">
                        <div class="search-input-wrapper">
                            <i class="fa-solid fa-magnifying-glass search-icon"></i>
                            <input type="text" id="search-query" placeholder="Search by name or brand..." value="${searchVal}">
                        </div>
                        <div class="sort-wrapper">
                            <label for="sort-select">Sort by:</label>
                            <select id="sort-select" class="sort-select">
                                <option value="medicineName-asc" ${sortVal === 'medicineName' && orderVal === 'asc' ? 'selected' : ''}>Name: A to Z</option>
                                <option value="medicineName-desc" ${sortVal === 'medicineName' && orderVal === 'desc' ? 'selected' : ''}>Name: Z to A</option>
                                <option value="price-asc" ${sortVal === 'price' && orderVal === 'asc' ? 'selected' : ''}>Price: Low to High</option>
                                <option value="price-desc" ${sortVal === 'price' && orderVal === 'desc' ? 'selected' : ''}>Price: High to Low</option>
                            </select>
                        </div>
                    </div>

                    ${medsList.length === 0 ? `
                        <div class="text-center" style="padding: 4rem 1rem;">
                            <i class="fa-solid fa-capsules text-muted" style="font-size:3.5rem;margin-bottom:1rem"></i>
                            <h3>No Medicines Found</h3>
                            <p>We couldn't find any products matching your search criteria.</p>
                        </div>
                    ` : `
                        <div class="medicines-grid">
                            ${medsList.map(med => renderMedicineCard(med)).join('')}
                        </div>
                    `}
                </section>
            </div>
        </div>
    `;

    // Filter Listeners
    document.getElementById('btn-apply-filters').onclick = () => {
        const cat = document.getElementById('filter-category').value;
        const min = document.getElementById('filter-min-price').value;
        const max = document.getElementById('filter-max-price').value;
        const q = document.getElementById('search-query').value;
        
        const nextParams = new URLSearchParams();
        if (cat) nextParams.set('category', cat);
        if (min) nextParams.set('minPrice', min);
        if (max) nextParams.set('maxPrice', max);
        if (q) nextParams.set('q', q);
        
        // Preserve sort
        const sortSelect = document.getElementById('sort-select').value.split('-');
        nextParams.set('sort', sortSelect[0]);
        nextParams.set('order', sortSelect[1]);

        navigateTo(`/medicines?${nextParams.toString()}`);
    };

    document.getElementById('btn-reset-filters').onclick = () => {
        navigateTo('/medicines');
    };

    // Sort select change listener
    document.getElementById('sort-select').onchange = (e) => {
        const [sort, order] = e.target.value.split('-');
        queryParams.set('sort', sort);
        queryParams.set('order', order);
        navigateTo(`/medicines?${queryParams.toString()}`);
    };

    // Search enter/type listener
    document.getElementById('search-query').onkeypress = (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btn-apply-filters').click();
        }
    };
}

// --- 3. PRODUCT DETAILS MODAL ---
async function openProductDetails(id) {
    const med = await apiFetch(`medicines/${id}`);
    if (!med || med.error) {
        showToast('Error loading medicine details.', 'danger');
        return;
    }

    const modal = document.getElementById('detail-modal');
    const content = document.getElementById('detail-modal-content');
    
    const isOutOfStock = med.stock <= 0;
    const defaultImg = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60";
    
    document.getElementById('detail-modal-title').textContent = med.medicineName;

    content.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1.25fr; gap:1.5rem;">
            <div style="background-color:var(--bg-surface-elevated);border-radius:var(--radius-md);overflow:hidden;height:220px;">
                <img src="${med.image || defaultImg}" alt="${med.medicineName}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='${defaultImg}'">
            </div>
            <div>
                <span class="med-card-brand" style="font-size:0.9rem">${med.brand}</span>
                <h3 style="font-size:1.5rem;margin-bottom:0.25rem;">${med.medicineName}</h3>
                <span class="status-badge ${isOutOfStock ? 'cancelled' : 'active'}" style="margin-bottom:1rem">${isOutOfStock ? 'Out of Stock' : 'In Stock (' + med.stock + ' left)'}</span>
                
                <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem">${med.description || 'No description provided.'}</p>
                
                <table style="width:100%;font-size:0.85rem;margin-bottom:1.5rem;border-collapse:collapse;">
                    <tr style="border-bottom:1px solid var(--border-color)"><td style="padding:0.4rem 0;font-weight:600">Category:</td><td>${med.category}</td></tr>
                    <tr style="border-bottom:1px solid var(--border-color)"><td style="padding:0.4rem 0;font-weight:600">Manufacturer:</td><td>${med.manufacturer || 'Unknown'}</td></tr>
                    <tr style="border-bottom:1px solid var(--border-color)"><td style="padding:0.4rem 0;font-weight:600">Expiry Date:</td><td>${med.expiryDate || 'N/A'}</td></tr>
                </table>

                <div style="display:flex;align-items:center;justify-content:space-between;padding-top:1rem;border-top:1px solid var(--border-color);">
                    <span style="font-size:1.75rem;font-weight:800;font-family:var(--font-heading)">$${parseFloat(med.price).toFixed(2)}</span>
                    
                    ${isOutOfStock ? `
                        <button class="btn btn-outline" disabled><i class="fa-solid fa-ban"></i> Out of Stock</button>
                    ` : `
                        <div style="display:flex;gap:0.75rem;align-items:center;">
                            <div class="quantity-control">
                                <button class="quantity-btn" onclick="adjustDetailQty(-1)">&minus;</button>
                                <input type="number" id="detail-qty" class="quantity-input" value="1" min="1" max="${med.stock}" readonly>
                                <button class="quantity-btn" onclick="adjustDetailQty(1, ${med.stock})">&plus;</button>
                            </div>
                            <button class="btn btn-primary" onclick="addToCart('${med._id}')"><i class="fa-solid fa-cart-plus"></i> Add to Cart</button>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
}

window.adjustDetailQty = (dir, maxStock) => {
    const input = document.getElementById('detail-qty');
    let val = parseInt(input.value) + dir;
    if (val < 1) val = 1;
    if (maxStock && val > maxStock) val = maxStock;
    input.value = val;
};

window.addToCart = async (medId) => {
    if (!state.user) {
        showToast('Please login to purchase medicines.', 'warning');
        document.getElementById('detail-modal').style.display = 'none';
        openAuthModal('login');
        return;
    }

    const qty = parseInt(document.getElementById('detail-qty').value);
    const res = await apiFetch('cart/add', {
        method: 'POST',
        body: JSON.stringify({ medicineId: medId, quantity: qty })
    });

    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Added medicine to shopping cart!', 'success');
        document.getElementById('detail-modal').style.display = 'none';
        fetchCartCount();
    }
};

// --- 4. CART VIEW ---
async function renderCart() {
    const root = document.getElementById('app-root');
    const cart = await apiFetch('cart');
    
    if (!cart || cart.error) {
        root.innerHTML = `<div class="container"><h2>Error</h2><p>Could not fetch your shopping cart.</p></div>`;
        return;
    }

    state.cart = cart;
    const items = cart.items || [];
    
    // Resolve medicine documents
    const medsPromises = items.map(item => apiFetch(`medicines/${item.medicineId}`));
    const medsDocs = await Promise.all(medsPromises);
    
    // Construct items array enriched with medicine documents
    const enrichedItems = items.map((item, idx) => {
        const med = medsDocs[idx];
        return {
            ...item,
            medicine: med && !med.error ? med : null
        };
    }).filter(item => item.medicine !== null);

    if (enrichedItems.length === 0) {
        root.innerHTML = `
            <div class="container text-center" style="padding:5rem 2rem;">
                <i class="fa-solid fa-cart-shopping text-muted" style="font-size:4rem;margin-bottom:1rem"></i>
                <h2>Your Cart is Empty</h2>
                <p>Browse our medicines list and add items to your cart.</p>
                <button class="btn btn-primary" onclick="navigateTo('/medicines')" style="margin-top:1.5rem"><i class="fa-solid fa-pills"></i> Shop Medicines</button>
            </div>
        `;
        return;
    }

    root.innerHTML = `
        <div class="container">
            <h1 class="page-title">Shopping Cart</h1>
            <p class="page-subtitle" style="margin-bottom:2rem">You have ${enrichedItems.length} unique items in your cart.</p>

            <div class="cart-layout">
                <!-- Cart Items Table -->
                <div class="table-responsive">
                    <table class="cart-table">
                        <thead>
                            <tr>
                                <th>Product Details</th>
                                <th>Unit Price</th>
                                <th>Quantity</th>
                                <th>Total</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${enrichedItems.map(item => `
                                <tr>
                                    <td>
                                        <div class="cart-item-info">
                                            <img src="${item.medicine.image || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60'}" class="cart-item-img" alt="${item.medicine.medicineName}">
                                            <div class="cart-item-details">
                                                <h4>${item.medicine.medicineName}</h4>
                                                <p>${item.medicine.brand}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td>$${parseFloat(item.price).toFixed(2)}</td>
                                    <td>
                                        <div class="quantity-control">
                                            <button class="quantity-btn" onclick="updateCartQty('${item.medicineId}', ${item.quantity - 1})">&minus;</button>
                                            <input type="number" class="quantity-input" value="${item.quantity}" readonly>
                                            <button class="quantity-btn" onclick="updateCartQty('${item.medicineId}', ${item.quantity + 1}, ${item.medicine.stock})">&plus;</button>
                                        </div>
                                    </td>
                                    <td style="font-weight:600">$${(item.price * item.quantity).toFixed(2)}</td>
                                    <td>
                                        <button class="btn btn-outline btn-sm text-danger" onclick="removeFromCart('${item.medicineId}')"><i class="fa-solid fa-trash-can"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="margin-top:1.5rem;display:flex;justify-content:space-between">
                        <button class="btn btn-outline" onclick="navigateTo('/medicines')"><i class="fa-solid fa-arrow-left"></i> Continue Shopping</button>
                        <button class="btn btn-danger" onclick="clearCart()"><i class="fa-solid fa-trash-can"></i> Clear Cart</button>
                    </div>
                </div>

                <!-- Summary Panel & Checkout -->
                <aside class="cart-summary">
                    <h3 style="margin-bottom:1.5rem;font-family:var(--font-heading)">Order Summary</h3>
                    <div class="summary-row">
                        <span>Subtotal:</span>
                        <span>$${parseFloat(cart.total).toFixed(2)}</span>
                    </div>
                    <div class="summary-row">
                        <span>Shipping/Delivery:</span>
                        <span class="text-success">FREE</span>
                    </div>
                    <div class="summary-row total">
                        <span>Grand Total:</span>
                        <span>$${parseFloat(cart.total).toFixed(2)}</span>
                    </div>

                    <form id="form-checkout" class="checkout-details">
                        <h4 style="margin-bottom:1rem;font-weight:600">Checkout Information</h4>
                        <div class="form-group">
                            <label>Delivery Address</label>
                            <textarea id="checkout-address" class="form-control" rows="2" required placeholder="Shipping Address">${state.user.address || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Payment Method</label>
                            <select id="checkout-payment" class="form-control">
                                <option value="Cash on Delivery">Cash on Delivery</option>
                                <option value="Card Online">Credit / Debit Card (Online)</option>
                                <option value="UPI">UPI / Digital Wallet</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block" style="margin-top:1.5rem"><i class="fa-solid fa-truck"></i> Place Order</button>
                    </form>
                </aside>
            </div>
        </div>
    `;

    // Checkout Submit Listener
    document.getElementById('form-checkout').onsubmit = async (e) => {
        e.preventDefault();
        
        // Update profile address if they changed it
        const address = document.getElementById('checkout-address').value;
        const payment = document.getElementById('checkout-payment').value;
        
        if (address !== state.user.address) {
            await apiFetch('profile', {
                method: 'PUT',
                body: JSON.stringify({ address })
            });
            state.user.address = address;
        }

        // Place Order
        const res = await apiFetch('orders', {
            method: 'POST',
            body: JSON.stringify({ paymentMethod: payment })
        });

        if (res.error) {
            showToast(res.error, 'danger');
        } else {
            showToast('Congratulations! Your order has been placed successfully.', 'success');
            fetchCartCount();
            navigateTo('/orders');
        }
    };
}

window.updateCartQty = async (medId, nextQty, maxStock) => {
    if (nextQty <= 0) {
        removeFromCart(medId);
        return;
    }
    if (maxStock && nextQty > maxStock) {
        showToast(`Cannot exceed total available stock (${maxStock} left).`, 'warning');
        return;
    }
    
    const res = await apiFetch('cart/update', {
        method: 'PUT',
        body: JSON.stringify({ medicineId: medId, quantity: nextQty })
    });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        fetchCartCount();
        renderCart();
    }
};

window.removeFromCart = async (medId) => {
    const res = await apiFetch(`cart/remove/${medId}`, { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Item removed from cart.');
        fetchCartCount();
        renderCart();
    }
};

window.clearCart = async () => {
    if (!confirm('Are you sure you want to empty your shopping cart?')) return;
    const res = await apiFetch('cart/clear', { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Cart cleared.');
        fetchCartCount();
        renderCart();
    }
};

// --- 5. CUSTOMER ORDERS VIEW ---
async function renderOrders() {
    const root = document.getElementById('app-root');
    const orders = await apiFetch('orders');
    
    if (!orders || orders.error) {
        root.innerHTML = `<div class="container"><h2>Error</h2><p>Could not fetch your orders history.</p></div>`;
        return;
    }

    const ordersList = Array.isArray(orders) ? orders : [];
    
    root.innerHTML = `
        <div class="container">
            <h1 class="page-title">My Orders</h1>
            <p class="page-subtitle" style="margin-bottom:2.5rem">Track your medicine shipments and order history.</p>

            ${ordersList.length === 0 ? `
                <div class="text-center" style="padding:4rem 1rem">
                    <i class="fa-solid fa-receipt text-muted" style="font-size:3.5rem;margin-bottom:1rem"></i>
                    <h3>No Orders Placed Yet</h3>
                    <p>When you purchase medicines, they will appear here.</p>
                </div>
            ` : `
                <div style="display:flex; flex-direction:column; gap:1.5rem">
                    ${ordersList.map(o => {
                        const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        }) : 'N/A';
                        
                        const statusClass = o.status.toLowerCase();
                        const canCancel = o.status === 'Pending';
                        
                        return `
                            <div class="dashboard-card">
                                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:1rem; margin-bottom:1rem; flex-wrap:wrap; gap:1rem">
                                    <div>
                                        <h3 style="font-size:1.1rem;font-family:var(--font-heading)">Order ID: #${o._id}</h3>
                                        <p style="font-size:0.85rem;color:var(--text-muted)"><i class="fa-solid fa-calendar"></i> Placed on ${dateStr}</p>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:1rem">
                                        <span class="status-badge ${statusClass}">${o.status}</span>
                                        <span style="font-weight:700;font-size:1.2rem;font-family:var(--font-heading)">$${o.totalAmount.toFixed(2)}</span>
                                    </div>
                                </div>
                                
                                <div style="margin-bottom:1rem">
                                    <h4 style="font-size:0.9rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.5rem">Items Ordered</h4>
                                    <div style="display:flex; flex-direction:column; gap:0.5rem">
                                        ${o.items.map(item => `
                                            <div style="display:flex; justify-content:space-between; font-size:0.9rem">
                                                <span>${item.medicineName} (x${item.quantity})</span>
                                                <span style="color:var(--text-secondary)">$${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>

                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; border-top:1px solid var(--border-color); padding-top:1rem; flex-wrap:wrap; gap:1rem">
                                    <div>
                                        <p><strong>Payment Method:</strong> ${o.paymentMethod}</p>
                                        <p><strong>Delivery Address:</strong> ${state.user.address || 'N/A'}</p>
                                    </div>
                                    <div>
                                        ${canCancel ? `
                                            <button class="btn btn-outline btn-sm text-danger" onclick="cancelOrder('${o._id}')"><i class="fa-solid fa-circle-xmark"></i> Cancel Order</button>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `}
        </div>
    `;
}

window.cancelOrder = async (orderId) => {
    if (!confirm('Are you sure you want to cancel this order? This cannot be undone.')) return;
    const res = await apiFetch(`orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Cancelled' })
    });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Your order has been cancelled.', 'success');
        renderOrders();
    }
};

// --- 6. PROFILE VIEW ---
async function renderProfile() {
    const root = document.getElementById('app-root');
    const user = await apiFetch('profile');
    
    if (!user || user.error) {
        root.innerHTML = `<div class="container"><h2>Error</h2><p>Could not fetch your profile details.</p></div>`;
        return;
    }
    
    state.user = user;
    const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    root.innerHTML = `
        <div class="container">
            <h1 class="page-title" style="margin-bottom:2rem">My Profile</h1>

            <div class="profile-layout">
                <!-- Profile Summary Card -->
                <aside class="profile-card">
                    <div class="avatar-large">${initials}</div>
                    <h3>${user.name}</h3>
                    <p style="color:var(--color-primary);font-weight:600;text-transform:capitalize;margin-bottom:1rem">${user.role}</p>
                    <p><i class="fa-solid fa-envelope"></i> ${user.email}</p>
                    <p><i class="fa-solid fa-phone"></i> ${user.phone || 'No phone set'}</p>
                </aside>

                <!-- Profile Edit Form -->
                <section class="profile-info-section">
                    <h3 style="margin-bottom:1.5rem;font-family:var(--font-heading)">Update Profile Details</h3>
                    <form id="form-profile-update">
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="prof-name">Full Name <span class="required">*</span></label>
                                <input type="text" id="prof-name" class="form-control" value="${user.name}" required>
                            </div>
                            <div class="form-group">
                                <label for="prof-phone">Phone Number</label>
                                <input type="tel" id="prof-phone" class="form-control" value="${user.phone || ''}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="prof-address">Delivery Address</label>
                            <textarea id="prof-address" class="form-control" rows="3">${user.address || ''}</textarea>
                        </div>
                        <div class="form-group" style="margin-top:1.5rem">
                            <label for="prof-password">New Password (leave blank to keep current)</label>
                            <input type="password" id="prof-password" class="form-control" placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary" style="margin-top:1rem"><i class="fa-solid fa-floppy-disk"></i> Save Profile Changes</button>
                    </form>
                </section>
            </div>
        </div>
    `;

    document.getElementById('form-profile-update').onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('prof-name').value;
        const phone = document.getElementById('prof-phone').value;
        const address = document.getElementById('prof-address').value;
        const password = document.getElementById('prof-password').value;

        const body = { name, phone, address };
        if (password) body.password = password;

        const res = await apiFetch('profile', {
            method: 'PUT',
            body: JSON.stringify(body)
        });

        if (res.error) {
            showToast(res.error, 'danger');
        } else {
            showToast('Profile updated successfully.', 'success');
            state.user = res.user;
            updateAuthUI();
            renderProfile();
        }
    };
}

// =====================================================================
// ADMIN VIEWS & HANDLERS
// =====================================================================

// --- 7. ADMIN DASHBOARD VIEW ---
async function renderAdminDashboard() {
    const root = document.getElementById('app-root');
    const stats = await apiFetch('dashboard');
    const recent = await apiFetch('dashboard/recent-orders');
    const lowStock = await apiFetch('dashboard/low-stock');

    if (!stats || stats.error) {
        root.innerHTML = `<div class="container"><h2>Access Denied</h2><p>Failed to retrieve dashboard metrics.</p></div>`;
        return;
    }

    const recentOrders = Array.isArray(recent) ? recent : [];
    const lowStockMeds = Array.isArray(lowStock) ? lowStock : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Admin Dashboard</h1>
                    <p class="page-subtitle">Real-time statistics, revenue, and inventory controls.</p>
                </div>
            </div>

            <!-- Stats Widgets -->
            <div class="dashboard-grid">
                <div class="dashboard-widget">
                    <div class="widget-icon-wrapper blue"><i class="fa-solid fa-capsules"></i></div>
                    <div class="widget-details">
                        <h3>Medicines</h3>
                        <div class="widget-value">${stats.totalMedicines}</div>
                    </div>
                </div>
                <div class="dashboard-widget">
                    <div class="widget-icon-wrapper green"><i class="fa-solid fa-chart-bar"></i></div>
                    <div class="widget-details">
                        <h3>Total Revenue</h3>
                        <div class="widget-value">$${stats.revenueSummary.toFixed(2)}</div>
                    </div>
                </div>
                <div class="dashboard-widget">
                    <div class="widget-icon-wrapper orange"><i class="fa-solid fa-truck-ramp-box"></i></div>
                    <div class="widget-details">
                        <h3>Total Orders</h3>
                        <div class="widget-value">${stats.totalOrders}</div>
                    </div>
                </div>
                <div class="dashboard-widget">
                    <div class="widget-icon-wrapper red"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div class="widget-details">
                        <h3>Low Stock</h3>
                        <div class="widget-value">${stats.lowStockMedicines}</div>
                    </div>
                </div>
            </div>

            <!-- Dashboard Sub sections (Tables) -->
            <div class="dashboard-tables-container">
                <!-- Recent Orders -->
                <div class="dashboard-card">
                    <div class="dashboard-card-header">
                        <h3 class="dashboard-card-title">Recent Orders</h3>
                        <a href="/admin/orders" class="btn btn-outline btn-sm">Manage Orders</a>
                    </div>
                    <div class="table-responsive">
                        <table class="cart-table" style="font-size:0.85rem">
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Status</th>
                                    <th>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recentOrders.map(o => `
                                    <tr>
                                        <td>
                                            <div style="font-weight:600">${o.userName}</div>
                                            <div style="font-size:0.75rem;color:var(--text-muted)">${o.userEmail}</div>
                                        </td>
                                        <td><span class="status-badge ${o.status.toLowerCase()}">${o.status}</span></td>
                                        <td style="font-weight:600">$${o.totalAmount.toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                                ${recentOrders.length === 0 ? '<tr><td colspan="3" class="text-center">No orders available.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Low Stock Alert -->
                <div class="dashboard-card">
                    <div class="dashboard-card-header">
                        <h3 class="dashboard-card-title">Critical Stock Alert (< 10)</h3>
                        <a href="/admin/medicines" class="btn btn-outline btn-sm">Restock</a>
                    </div>
                    <div class="table-responsive">
                        <table class="cart-table" style="font-size:0.85rem">
                            <thead>
                                <tr>
                                    <th>Medicine</th>
                                    <th>Brand</th>
                                    <th>Stock</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lowStockMeds.map(m => `
                                    <tr>
                                        <td><div style="font-weight:600">${m.medicineName}</div></td>
                                        <td>${m.brand}</td>
                                        <td class="text-danger" style="font-weight:700">${m.stock} units</td>
                                    </tr>
                                `).join('')}
                                ${lowStockMeds.length === 0 ? '<tr><td colspan="3" class="text-center text-success">All products are healthy in stock.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// --- 8. ADMIN INVENTORY (MEDICINE MANAGEMENT) ---
async function renderAdminInventory() {
    const root = document.getElementById('app-root');
    const medicines = await apiFetch('medicines');
    const medsList = Array.isArray(medicines) ? medicines : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Medicine Inventory</h1>
                    <p class="page-subtitle">Add, edit, delete, and restock medical products.</p>
                </div>
                <button class="btn btn-primary" onclick="openMedicineFormModal()"><i class="fa-solid fa-plus"></i> Add Medicine</button>
            </div>

            <div class="dashboard-card">
                <div class="table-responsive">
                    <table class="cart-table" style="font-size:0.9rem">
                        <thead>
                            <tr>
                                <th>Name / Brand</th>
                                <th>Category</th>
                                <th>Price</th>
                                <th>Stock</th>
                                <th>Expiry Date</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${medsList.map(m => `
                                <tr>
                                    <td>
                                        <div style="font-weight:600">${m.medicineName}</div>
                                        <div style="font-size:0.75rem;color:var(--text-muted)">Brand: ${m.brand}</div>
                                    </td>
                                    <td>${m.category}</td>
                                    <td>$${parseFloat(m.price).toFixed(2)}</td>
                                    <td>
                                        <span style="font-weight:700; color: ${m.stock < 10 ? 'var(--color-danger)' : 'inherit'}">
                                            ${m.stock}
                                        </span>
                                    </td>
                                    <td>${m.expiryDate || 'N/A'}</td>
                                    <td>
                                        <div style="display:flex;gap:0.5rem">
                                            <button class="btn btn-outline btn-sm" onclick="openMedicineFormModal('${m._id}')"><i class="fa-solid fa-pencil"></i> Edit</button>
                                            <button class="btn btn-outline btn-sm text-danger" onclick="deleteMedicine('${m._id}')"><i class="fa-solid fa-trash-can"></i> Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

window.openMedicineFormModal = async (id = null) => {
    const modal = document.getElementById('medicine-modal');
    const form = document.getElementById('form-medicine');
    const title = document.getElementById('medicine-modal-title');
    
    // Clear form
    form.reset();
    document.getElementById('med-id').value = '';

    if (id) {
        title.textContent = 'Edit Medicine';
        const med = await apiFetch(`medicines/${id}`);
        if (med && !med.error) {
            document.getElementById('med-id').value = med._id;
            document.getElementById('med-name').value = med.medicineName;
            document.getElementById('med-brand').value = med.brand;
            document.getElementById('med-category').value = med.category;
            document.getElementById('med-manufacturer').value = med.manufacturer || '';
            document.getElementById('med-price').value = med.price;
            document.getElementById('med-stock').value = med.stock;
            document.getElementById('med-expiry').value = med.expiryDate || '';
            document.getElementById('med-image').value = med.image || '';
            document.getElementById('med-description').value = med.description || '';
        }
    } else {
        title.textContent = 'Add New Medicine';
    }

    modal.style.display = 'flex';
};

document.getElementById('form-medicine').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('med-id').value;
    const data = {
        medicineName: document.getElementById('med-name').value,
        brand: document.getElementById('med-brand').value,
        category: document.getElementById('med-category').value,
        manufacturer: document.getElementById('med-manufacturer').value,
        price: parseFloat(document.getElementById('med-price').value),
        stock: parseInt(document.getElementById('med-stock').value),
        expiryDate: document.getElementById('med-expiry').value,
        image: document.getElementById('med-image').value,
        description: document.getElementById('med-description').value,
    };

    let res;
    if (id) {
        res = await apiFetch(`medicines/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    } else {
        res = await apiFetch('medicines', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Product configuration saved.', 'success');
        document.getElementById('medicine-modal').style.display = 'none';
        renderAdminInventory();
    }
};

document.getElementById('btn-medicine-cancel').onclick = () => {
    document.getElementById('medicine-modal').style.display = 'none';
};

window.deleteMedicine = async (id) => {
    if (!confirm('Are you sure you want to delete this medicine product? This cannot be undone.')) return;
    const res = await apiFetch(`medicines/${id}`, { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Medicine deleted successfully.');
        renderAdminInventory();
    }
};

// --- 9. ADMIN CATEGORY MANAGEMENT ---
async function renderAdminCategories() {
    const root = document.getElementById('app-root');
    const categories = await apiFetch('categories');
    const catsList = Array.isArray(categories) ? categories : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Category Management</h1>
                    <p class="page-subtitle">Add, modify, or delete medicine category tags.</p>
                </div>
                <button class="btn btn-primary" onclick="openCategoryFormModal()"><i class="fa-solid fa-plus"></i> Add Category</button>
            </div>

            <div class="dashboard-card" style="max-width:800px;">
                <div class="table-responsive">
                    <table class="cart-table">
                        <thead>
                            <tr>
                                <th>Category Name</th>
                                <th>Description</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${catsList.map(c => `
                                <tr>
                                    <td><div style="font-weight:600">${c.categoryName}</div></td>
                                    <td>${c.description || 'No description set'}</td>
                                    <td>
                                        <div style="display:flex;gap:0.5rem">
                                            <button class="btn btn-outline btn-sm" onclick="openCategoryFormModal('${c._id}')"><i class="fa-solid fa-pencil"></i> Edit</button>
                                            <button class="btn btn-outline btn-sm text-danger" onclick="deleteCategory('${c._id}')"><i class="fa-solid fa-trash-can"></i> Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

window.openCategoryFormModal = async (id = null) => {
    const modal = document.getElementById('category-modal');
    const form = document.getElementById('form-category');
    const title = document.getElementById('category-modal-title');
    
    form.reset();
    document.getElementById('cat-id').value = '';

    if (id) {
        title.textContent = 'Edit Category';
        const cat = await apiFetch(`categories/${id}`);
        if (cat && !cat.error) {
            document.getElementById('cat-id').value = cat._id;
            document.getElementById('cat-name').value = cat.categoryName;
            document.getElementById('cat-description').value = cat.description || '';
        }
    } else {
        title.textContent = 'Add Category';
    }

    modal.style.display = 'flex';
};

document.getElementById('form-category').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('cat-id').value;
    const name = document.getElementById('cat-name').value;
    const desc = document.getElementById('cat-description').value;

    let res;
    if (id) {
        res = await apiFetch(`categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ categoryName: name, description: desc })
        });
    } else {
        res = await apiFetch('categories', {
            method: 'POST',
            body: JSON.stringify({ categoryName: name, description: desc })
        });
    }

    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Category details saved successfully.', 'success');
        document.getElementById('category-modal').style.display = 'none';
        
        // Refresh global state
        const cats = await apiFetch('categories');
        if (Array.isArray(cats)) {
            state.categories = cats;
            updateCategoryDropdowns();
        }
        renderAdminCategories();
    }
};

document.getElementById('btn-category-cancel').onclick = () => {
    document.getElementById('category-modal').style.display = 'none';
};

window.deleteCategory = async (id) => {
    if (!confirm('Are you sure you want to delete this category? All products under it will remain but won\'t map to it in categories catalog.')) return;
    const res = await apiFetch(`categories/${id}`, { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Category deleted successfully.');
        
        // Refresh categories
        const cats = await apiFetch('categories');
        if (Array.isArray(cats)) {
            state.categories = cats;
            updateCategoryDropdowns();
        }
        renderAdminCategories();
    }
};

// --- 10. ADMIN USERS MANAGEMENT ---
async function renderAdminUsers() {
    const root = document.getElementById('app-root');
    const users = await apiFetch('users');
    const usersList = Array.isArray(users) ? users : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">User Accounts</h1>
                    <p class="page-subtitle">View, block, activate, or delete customer accounts.</p>
                </div>
            </div>

            <div class="dashboard-card">
                <div class="table-responsive">
                    <table class="cart-table" style="font-size:0.9rem">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Phone</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${usersList.map(u => {
                                const isSelf = u._id === state.user._id;
                                const isBlocked = u.isBlocked || u.status === 'Blocked';
                                
                                return `
                                    <tr>
                                        <td><div style="font-weight:600">${u.name} ${isSelf ? '<span class="status-badge active" style="font-size:0.65rem;padding:0.15rem 0.4rem">You</span>' : ''}</div></td>
                                        <td>${u.email}</td>
                                        <td>${u.phone || 'N/A'}</td>
                                        <td><span style="text-transform:capitalize;font-weight:600">${u.role}</span></td>
                                        <td>
                                            <span class="status-badge ${isBlocked ? 'cancelled' : 'active'}">
                                                ${isBlocked ? 'Blocked' : 'Active'}
                                            </span>
                                        </td>
                                        <td>
                                            ${isSelf ? `
                                                <button class="btn btn-outline btn-sm" disabled>No actions</button>
                                            ` : `
                                                <div style="display:flex;gap:0.5rem">
                                                    <button class="btn ${isBlocked ? 'btn-success' : 'btn-danger'} btn-sm" onclick="toggleUserStatus('${u._id}', ${isBlocked})">
                                                        <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-lock'}"></i> ${isBlocked ? 'Activate' : 'Block'}
                                                    </button>
                                                    <button class="btn btn-outline btn-sm text-danger" onclick="deleteUser('${u._id}')">
                                                        <i class="fa-solid fa-trash-can"></i> Delete
                                                    </button>
                                                </div>
                                            `}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

window.toggleUserStatus = async (userId, currentlyBlocked) => {
    const nextStatus = currentlyBlocked ? 'Active' : 'Blocked';
    const res = await apiFetch(`users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
    });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast(`User account status updated to ${nextStatus}.`, 'success');
        renderAdminUsers();
    }
};

window.deleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? All their details will be erased.')) return;
    const res = await apiFetch(`users/${userId}`, { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('User deleted successfully.');
        renderAdminUsers();
    }
};

// --- 11. ADMIN ORDERS MANAGEMENT ---
async function renderAdminOrders() {
    const root = document.getElementById('app-root');
    const orders = await apiFetch('orders');
    const ordersList = Array.isArray(orders) ? orders : [];

    root.innerHTML = `
        <div class="container">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Order Management</h1>
                    <p class="page-subtitle">Track payments, update shipping status, and dispatch orders.</p>
                </div>
            </div>

            <div class="dashboard-card">
                <div class="table-responsive">
                    <table class="cart-table" style="font-size:0.85rem">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Customer Details</th>
                                <th>Items Ordered</th>
                                <th>Total Amount</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ordersList.map(o => `
                                <tr>
                                    <td><div style="font-weight:600">#${o._id}</div></td>
                                    <td>
                                        <div style="font-weight:600">${o.userName}</div>
                                        <div style="font-size:0.75rem;color:var(--text-muted)">${o.userEmail}</div>
                                    </td>
                                    <td>
                                        <div style="max-height:80px;overflow-y:auto;line-height:1.4">
                                            ${o.items.map(i => `<div>&bull; ${i.medicineName} (x${i.quantity})</div>`).join('')}
                                        </div>
                                    </td>
                                    <td style="font-weight:700">$${o.totalAmount.toFixed(2)}</td>
                                    <td>
                                        <select class="form-control" style="font-size:0.8rem;padding:0.35rem 0.5rem;width:125px" onchange="updateOrderStatus('${o._id}', this.value)">
                                            <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                            <option value="Dispatched" ${o.status === 'Dispatched' ? 'selected' : ''}>Dispatched</option>
                                            <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                                            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                                        </select>
                                    </td>
                                    <td>
                                        <button class="btn btn-outline btn-sm text-danger" onclick="deleteOrder('${o._id}')"><i class="fa-solid fa-trash-can"></i> Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                            ${ordersList.length === 0 ? '<tr><td colspan="6" class="text-center">No orders have been placed yet.</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

window.updateOrderStatus = async (orderId, newStatus) => {
    const res = await apiFetch(`orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
    });
    if (res.error) {
        showToast(res.error, 'danger');
        renderAdminOrders(); // Reset dropdown on error
    } else {
        showToast(`Order status updated to ${newStatus}.`, 'success');
    }
};

window.deleteOrder = async (orderId) => {
    if (!confirm('Are you sure you want to delete this order document? This will remove it from all database records.')) return;
    const res = await apiFetch(`orders/${orderId}`, { method: 'DELETE' });
    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Order deleted successfully.');
        renderAdminOrders();
    }
};

// Update selection lists inside category modals
function updateCategoryDropdowns() {
    const dropdown = document.getElementById('med-category');
    if (dropdown) {
        dropdown.innerHTML = state.categories.map(c => `<option value="${c.categoryName}">${c.categoryName}</option>`).join('');
    }
}

function updateCategoryDropdownsForSidebar() {
    const sidebarDropdown = document.getElementById('filter-category');
    if (sidebarDropdown) {
        const activeVal = sidebarDropdown.value;
        sidebarDropdown.innerHTML = `<option value="">All Categories</option>` + 
            state.categories.map(c => `<option value="${c.categoryName}" ${c.categoryName === activeVal ? 'selected' : ''}>${c.categoryName}</option>`).join('');
    }
}

// Ensure category options are kept in sync
const originalCategoriesUpdate = updateCategoryDropdowns;
updateCategoryDropdowns = () => {
    originalCategoriesUpdate();
    updateCategoryDropdownsForSidebar();
};

// =====================================================================
// AUTHENTICATION FORMS LISTENERS & DELEGATIONS
// =====================================================================

// Theme management
const themeBtn = document.getElementById('theme-toggle');
const htmlRoot = document.documentElement;

themeBtn.onclick = () => {
    const currentTheme = htmlRoot.getAttribute('data-theme');
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    htmlRoot.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
};

// Load saved theme on load
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
    htmlRoot.setAttribute('data-theme', savedTheme);
}

// Header Dropdown profile
const profileBtn = document.getElementById('btn-profile-toggle');
const dropdownMenu = document.getElementById('profile-dropdown');

profileBtn.onclick = (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
};

document.addEventListener('click', () => {
    dropdownMenu.classList.remove('show');
});

// Hamburger menu toggle
const hamburgerBtn = document.getElementById('hamburger');
const appNav = document.getElementById('app-navigation');

hamburgerBtn.onclick = () => {
    appNav.classList.toggle('show');
};

// Modal triggers
document.getElementById('btn-login-open').onclick = () => openAuthModal('login');
document.getElementById('btn-register-open').onclick = () => openAuthModal('register');
document.getElementById('auth-modal-close').onclick = () => closeAuthModal();
document.getElementById('switch-to-signup').onclick = (e) => { e.preventDefault(); openAuthModal('register'); };
document.getElementById('switch-to-login').onclick = (e) => { e.preventDefault(); openAuthModal('login'); };

// Medicine and Category modal close listeners
document.getElementById('medicine-modal-close').onclick = () => document.getElementById('medicine-modal').style.display = 'none';
document.getElementById('category-modal-close').onclick = () => document.getElementById('category-modal').style.display = 'none';
document.getElementById('detail-modal-close').onclick = () => document.getElementById('detail-modal').style.display = 'none';

// Login form submit
document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const res = await apiFetch('login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Successfully logged in!', 'success');
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('token', res.token);
        
        closeAuthModal();
        updateAuthUI();
        
        // Redirect based on role
        if (res.user.role === 'admin') {
            navigateTo('/admin/dashboard');
        } else {
            navigateTo('/');
        }
    }
};

// Registration form submit
document.getElementById('form-register').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-password').value;
    const address = document.getElementById('reg-address').value;
    const role = document.getElementById('reg-role').value;

    const res = await apiFetch('register', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone, password, address, role })
    });

    if (res.error) {
        showToast(res.error, 'danger');
    } else {
        showToast('Registration successful! Logged in.', 'success');
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('token', res.token);
        
        closeAuthModal();
        updateAuthUI();
        
        if (res.user.role === 'admin') {
            navigateTo('/admin/dashboard');
        } else {
            navigateTo('/');
        }
    }
};

// Logout Button
document.getElementById('btn-logout').onclick = async () => {
    const res = await apiFetch('logout', { method: 'POST' });
    if (!res.error) {
        state.token = null;
        state.user = null;
        localStorage.removeItem('token');
        showToast('Successfully logged out.');
        updateAuthUI();
        navigateTo('/');
    } else {
        showToast('Logout failed.', 'danger');
    }
};

// Initialize Application
initializeAuth();
