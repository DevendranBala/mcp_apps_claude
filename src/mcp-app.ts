/**
 * AT&T Shopping MCP App UI
 * 
 * Interactive UI with carousel navigation using prev/next arrows.
 */

import { App } from "@modelcontextprotocol/ext-apps";

// ============================================================
// TYPES
// ============================================================

interface Product {
  product_id: string;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  monthly_price?: number;
  stock: number;
  description: string;
  brand: string;
  rating: number;
  image?: string;
  color?: string;
  colors?: string[];  // Array of available colors
  storage?: string;
  storage_prices?: string;  // Format: "128GB:0|256GB:100|512GB:200"
  ranking?: number;
}

interface Plan {
  plan_id: string;
  name: string;
  category: string;
  price_monthly: number;
  description: string;
  data_limit: string;
  hotspot: string;
  streaming: string;
  features: string;
  popular?: boolean;
}

interface InternetPlan {
  plan_id: string;
  name: string;
  category: string;  // "Fiber" or "Internet Air"
  price_monthly: number;
  speed_down: string;
  speed_up: string;
  description: string;
  features: string;
  popular?: boolean;
  requires_qualification?: boolean;
}

interface InternetResponse {
  plans: InternetPlan[];
  qualification_status?: {
    address: string;
    zip: string;
    fiber_available: boolean;
    qualified_at?: string;
  };
  message?: string;
  plan_type?: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  type: string;
  color?: string;
  storage?: string;
}

interface CartData {
  items: CartItem[];
  item_count: number;
  subtotal: number;
  discount: number;
  promo_code: string | null;
  tax: number;
  shipping: number;
  total: number;
}

interface InventorySummary {
  total_products: number;
  total_stock: number;
  total_value: number;
  low_stock: number;
  out_of_stock: number;
  by_category: Record<string, number>;
  by_brand: Record<string, number>;
}

interface StoreLocation {
  id?: string;
  name?: string;
  mystore_name?: string;
  channel?: string;
  vtype?: string;
  inv_id?: string;
  opus_id?: string;
  services?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalcode?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  hours?: string;
  sundayopen?: string;
  sundayclose?: string;
  mondayopen?: string;
  mondayclose?: string;
  tuesdayopen?: string;
  tuesdayclose?: string;
  wednesdayopen?: string;
  wednesdayclose?: string;
  thursdayopen?: string;
  thursdayclose?: string;
  fridayopen?: string;
  fridayclose?: string;
  saturdayopen?: string;
  saturdayclose?: string;
  [key: string]: unknown; // Allow dynamic field access for hours parsing
}

interface StoreSearchResult {
  stores: StoreLocation[];
  totalCount: number;
  searchLocation?: string;
  searchPostal?: string;
  success?: boolean;
  message?: string;
  error?: string;
}

type ViewType = "phones" | "accessories" | "plans" | "internet" | "cart" | "inventory" | "stores";

// Navigation history entry
interface HistoryEntry {
  view: ViewType;
  data: unknown;
  page: number;
}

// ============================================================
// APP STATE
// ============================================================

const appContainer = document.getElementById("app")!;
const app = new App({ name: "AT&T Shopping", version: "1.0.0" });

let currentView: ViewType = "phones";
let currentData: unknown = null;
let currentPage = 0;
const ITEMS_PER_PAGE = 3;

// Cart state for badge
let cartState: CartData | null = null;

// Store map state
let selectedStoreIndex: number = 0;

// Navigation history for back button
const navigationHistory: HistoryEntry[] = [];

// ============================================================
// WIDGET-TO-WIDGET COMMUNICATION (BroadcastChannel Event Bus)
// ============================================================

// Shared channel for all AT&T MCP widget instances
const widgetChannel = new BroadcastChannel("att-mcp-widgets");

// Selected store shared across widgets
let selectedStore: StoreLocation | null = null;

// Widget event types
interface WidgetEvent {
  type: 
    | "store:selected"      // User selected a store (from Store Locator)
    | "store:setPickup"     // User wants pickup at this store (from Store Locator)
    | "cart:updated"        // Cart was modified (from any widget)
    | "cart:setAddress"     // Set shipping/pickup address (from Store Locator)
    | "phone:findInStore"   // User wants to find a phone in a store (from Phone Browser)
    | "plan:selected"       // User selected a plan (from Plan Browser)
    | "navigate:phones"     // Navigate to phones view
    | "navigate:plans"      // Navigate to plans view
    | "navigate:cart"       // Navigate to cart view
    | "navigate:stores"     // Navigate to stores view
    | "ping"                // Heartbeat / discover other widgets
    | "pong";               // Response to ping
  source: ViewType;         // Which widget sent this
  payload?: unknown;
}

// Broadcast an event to all other widgets
function broadcastEvent(event: WidgetEvent): void {
  try {
    widgetChannel.postMessage(event);
    // Also store latest state for widgets that load later
    if (event.type === "store:selected" || event.type === "store:setPickup") {
      try {
        sessionStorage.setItem("att-mcp-selectedStore", JSON.stringify(event.payload));
      } catch { /* sessionStorage not available */ }
    }
    if (event.type === "cart:updated") {
      try {
        sessionStorage.setItem("att-mcp-cartState", JSON.stringify(event.payload));
      } catch { /* sessionStorage not available */ }
    }
  } catch (e) {
    console.warn("Widget broadcast failed:", e);
  }
}

// Handle incoming widget events
widgetChannel.onmessage = (e: MessageEvent<WidgetEvent>) => {
  const event = e.data;
  if (!event?.type) return;

  switch (event.type) {
    case "store:selected": {
      // Another widget selected a store — update our local reference
      selectedStore = event.payload as StoreLocation;
      // If we're in cart view, show a toast about pickup availability
      if (currentView === "cart") {
        const store = event.payload as StoreLocation;
        showToast("info", "Store Selected", 
          `${store.name || "AT&T Store"} — ${store.address1 || ""}, ${store.city || ""}`);
      }
      break;
    }

    case "store:setPickup": {
      // Store locator says "use this store for pickup"
      selectedStore = event.payload as StoreLocation;
      if (currentView === "cart") {
        showToast("success", "Pickup Store Set", 
          `Pickup at: ${selectedStore.name || "AT&T Store"}, ${selectedStore.city || ""}`);
        // Re-render cart to show pickup option
        render();
      }
      break;
    }

    case "cart:updated": {
      // Another widget updated the cart — refresh our badge
      const cartData = event.payload as CartData;
      if (cartData) {
        cartState = cartData;
        updateCartBadge();
        if (currentView === "cart") {
          currentData = cartData;
          render();
        }
      }
      break;
    }

    case "navigate:phones": {
      // Another widget wants us to show phones
      if (currentView !== "phones") {
        pushHistory();
        loadPhones();
      }
      break;
    }

    case "navigate:plans": {
      if (currentView !== "plans") {
        pushHistory();
        loadPlans();
      }
      break;
    }

    case "navigate:cart": {
      if (currentView !== "cart") {
        pushHistory();
        loadCart();
      }
      break;
    }

    case "ping": {
      // Respond with our current view type
      broadcastEvent({ type: "pong", source: currentView, payload: { view: currentView } });
      break;
    }

    default:
      break;
  }
};

// Helper functions to load views via server tools

/**
 * Extract and parse JSON data from MCP tool results.
 * Handles the MCP framework's double-wrapping: the actual data may be inside
 * result.content[0].text → JSON.parse → { text: "<inner JSON string>" }
 * This unwraps all layers to get the real data.
 */
function parseToolResult(result: unknown): unknown | null {
  if (!result) return null;
  const r = result as Record<string, unknown>;
  
  // Step 1: Extract text string from content blocks
  let text = "";
  if (Array.isArray(r?.content)) {
    const blocks = r.content as Record<string, unknown>[];
    // Prefer JSON-looking blocks (for two-block responses like store locator)
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") {
        const t = (b.text as string).trim();
        if (t.startsWith("{") || t.startsWith("[")) { text = t; break; }
      }
    }
    // Fallback: first text block
    if (!text) {
      const first = blocks.find(b => b.type === "text" && typeof b.text === "string");
      if (first) text = (first.text as string).trim();
    }
  }
  if (!text) return null;
  
  // Step 2: Parse outer JSON
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  
  // Step 3: Unwrap { text: "<json string>" } envelope (MCP framework double-wrapping)
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    // If the only key (or primary key) is "text" and its value is a JSON string, unwrap it
    if (typeof obj.text === "string") {
      const inner = (obj.text as string).trim();
      if (inner.startsWith("{") || inner.startsWith("[")) {
        try { data = JSON.parse(inner); } catch { /* keep outer data */ }
      }
    }
    // Also handle { structuredContent: {...} } wrapping
    if (typeof obj.structuredContent === "object" && obj.structuredContent !== null) {
      data = obj.structuredContent;
    }
  }
  
  return data;
}

/**
 * Extract raw text content from MCP tool result (for success/error messages).
 * Unwraps { text: "..." } envelope if present.
 */
function extractResultText(result: unknown): string {
  if (!result) return "";
  const r = result as Record<string, unknown>;
  let text = "";
  if (Array.isArray(r?.content)) {
    const block = (r.content as Record<string, unknown>[]).find(b => b.type === "text" && typeof b.text === "string");
    if (block) text = block.text as string;
  }
  if (!text) return "";
  // Unwrap { text: "..." } envelope
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch { /* not JSON, use raw */ }
  return text;
}

async function loadPhones(): Promise<void> {
  try {
    const result = await app.callServerTool({ name: "get_phones", arguments: {} });
    const data = parseToolResult(result);
    if (data) {
      currentData = data;
      currentView = "phones";
      currentPage = 0;
      render();
    }
  } catch (e) { console.error("loadPhones failed:", e); }
}

async function loadPlans(): Promise<void> {
  try {
    const result = await app.callServerTool({ name: "get_wireless_plans", arguments: {} });
    const data = parseToolResult(result);
    if (data) {
      currentData = data;
      currentView = "plans";
      currentPage = 0;
      render();
    }
  } catch (e) { console.error("loadPlans failed:", e); }
}

async function loadCart(): Promise<void> {
  try {
    const result = await app.callServerTool({ name: "get_cart", arguments: {} });
    const data = parseToolResult(result);
    if (data) {
      currentData = data;
      currentView = "cart";
      render();
    }
  } catch (e) { console.error("loadCart failed:", e); }
}

// On startup, restore any shared state from sessionStorage
function restoreSharedState(): void {
  try {
    const storedStore = sessionStorage.getItem("att-mcp-selectedStore");
    if (storedStore) {
      selectedStore = JSON.parse(storedStore);
    }
  } catch { /* ignore */ }
}

// Function to save current state to history before navigating
function pushHistory(): void {
  if (currentData && currentView !== "cart") {
    navigationHistory.push({
      view: currentView,
      data: currentData,
      page: currentPage
    });
    // Keep only last 10 entries
    if (navigationHistory.length > 10) {
      navigationHistory.shift();
    }
  }
}

// Function to go back to previous view
function goBack(): void {
  if (navigationHistory.length > 0) {
    const prev = navigationHistory.pop()!;
    currentView = prev.view;
    currentData = prev.data;
    currentPage = prev.page;
    render();
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(type: "success" | "error" | "info", title: string, message: string): void {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <div class="toast-content">
      <h4>${title}</h4>
      <p>${message}</p>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 3000);
}

// ============================================================
// CART BADGE & MINI CART
// ============================================================

async function fetchCartState(): Promise<void> {
  try {
    const result = await app.callServerTool({
      name: "get_cart",
      arguments: {},
    });
    const data = parseToolResult(result);
    if (data) {
      cartState = data as CartData;
      updateCartBadge();
    }
  } catch (e) {
    console.error("Failed to fetch cart:", e);
  }
}

function updateCartBadge(): void {
  let badge = document.querySelector(".cart-badge") as HTMLElement;
  let miniCart = document.querySelector(".mini-cart") as HTMLElement;
  
  if (!cartState || cartState.item_count === 0) {
    if (badge) badge.remove();
    if (miniCart) miniCart.remove();
    return;
  }
  
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "cart-badge";
    badge.addEventListener("click", toggleMiniCart);
    document.body.appendChild(badge);
  }
  
  badge.innerHTML = `
    🛒 <span>Cart</span>
    <span class="count">${cartState.item_count}</span>
  `;
  
  // Update mini cart content
  if (!miniCart) {
    miniCart = document.createElement("div");
    miniCart.className = "mini-cart";
    document.body.appendChild(miniCart);
  }
  
  miniCart.innerHTML = `
    <h3>🛒 Your Cart</h3>
    ${cartState.items.slice(0, 3).map(item => `
      <div class="mini-cart-item">
        <span>${item.name}</span>
        <span>$${(item.price * item.quantity).toFixed(2)}</span>
      </div>
    `).join("")}
    ${cartState.items.length > 3 ? `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 8px 0;">+${cartState.items.length - 3} more items</div>` : ""}
    <div class="mini-cart-total">
      <span>Total</span>
      <span>$${cartState.total.toFixed(2)}</span>
    </div>
    <div class="mini-cart-actions">
      <button class="btn btn-primary" id="view-full-cart">View Full Cart</button>
    </div>
  `;
  
  // Add event listener for view cart button
  const viewCartBtn = miniCart.querySelector("#view-full-cart");
  if (viewCartBtn) {
    viewCartBtn.addEventListener("click", async () => {
      miniCart.classList.remove("visible");
      try {
        const result = await app.callServerTool({
          name: "get_cart",
          arguments: {},
        });
        const data = parseToolResult(result);
        if (data) {
          currentData = data;
          currentView = "cart";
          render();
        }
      } catch (e) {
        console.error(e);
      }
    });
  }
}

function toggleMiniCart(): void {
  const miniCart = document.querySelector(".mini-cart");
  if (miniCart) {
    miniCart.classList.toggle("visible");
  }
}

// Close mini cart when clicking outside
document.addEventListener("click", (e) => {
  const miniCart = document.querySelector(".mini-cart");
  const cartBadge = document.querySelector(".cart-badge");
  if (miniCart && cartBadge) {
    if (!miniCart.contains(e.target as Node) && !cartBadge.contains(e.target as Node)) {
      miniCart.classList.remove("visible");
    }
  }
});

// ============================================================
// IMAGE HELPERS
// ============================================================

const PRODUCT_IMAGES: Record<string, string> = {
  "ATT-IP15PM": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP15P": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP15": "https://i.imgur.com/kHdpNjZ.png",
  "ATT-IP14": "https://i.imgur.com/VhZxMqH.png",
  "ATT-IP16PM": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP16P": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP16": "https://i.imgur.com/kHdpNjZ.png",
  "ATT-IP17PM": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP17P": "https://i.imgur.com/JgYf2vB.png",
  "ATT-IP17AIR": "https://i.imgur.com/kHdpNjZ.png",
  "ATT-IP17": "https://i.imgur.com/kHdpNjZ.png",
  "ATT-S24U": "https://i.imgur.com/8KsQPjq.png",
  "ATT-S24P": "https://i.imgur.com/8KsQPjq.png",
  "ATT-S24": "https://i.imgur.com/8KsQPjq.png",
  "ATT-S25U": "https://i.imgur.com/8KsQPjq.png",
  "ATT-S25P": "https://i.imgur.com/8KsQPjq.png",
  "ATT-S25": "https://i.imgur.com/8KsQPjq.png",
  "ATT-ZF5": "https://i.imgur.com/wNzDf5Y.png",
  "ATT-ZFL5": "https://i.imgur.com/wNzDf5Y.png",
  "ATT-ZF6": "https://i.imgur.com/wNzDf5Y.png",
  "ATT-ZFL6": "https://i.imgur.com/wNzDf5Y.png",
  "ATT-P8P": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P8": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P9P": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P9": "https://i.imgur.com/9D3zKjL.png",
  "ATT-APP2": "https://i.imgur.com/YqKsV3r.png",
  "ATT-APP3": "https://i.imgur.com/YqKsV3r.png",
  "ATT-GBP2": "https://i.imgur.com/L3kR5Wp.png",
  "ATT-MAGSAFE": "https://i.imgur.com/mXvZf7P.png",
};

function getProductImage(product: Product): string {
  if (PRODUCT_IMAGES[product.product_id]) return PRODUCT_IMAGES[product.product_id];
  if (product.category === "Accessories") return "https://i.imgur.com/mXvZf7P.png";
  return "https://i.imgur.com/JgYf2vB.png";
}

function getStockInfo(stock: number): { class: string; label: string } {
  if (stock === 0) return { class: "stock-out", label: "Out of Stock" };
  if (stock <= 10) return { class: "stock-low", label: `Low Stock (${stock})` };
  return { class: "stock-high", label: `In Stock` };
}

// Color name to CSS color mapping
const COLOR_MAP: Record<string, string> = {
  // iPhone colors
  'cosmic orange': '#FF6B35',
  'space black': '#1D1D1F',
  'natural titanium': '#A8A9AD',
  'desert titanium': '#C4A77D',
  'ultramarine': '#2851A3',
  'teal': '#008080',
  'pink': '#FFB6C1',
  'white': '#FAFAFA',
  'black': '#1D1D1F',
  'starlight': '#F5F5DC',
  'midnight': '#1D1D1F',
  'blue': '#007AFF',
  'purple': '#9B59B6',
  'yellow': '#FFD700',
  'red': '#FF3B30',
  'green': '#34C759',
  'blue titanium': '#394867',
  'white titanium': '#E8E8E8',
  'black titanium': '#2D2D2D',
  // Samsung colors
  'titanium black': '#1D1D1F',
  'titanium gray': '#808080',
  'titanium silver blue': '#6B7B8C',
  'titanium white silver': '#E8E8E8',
  'titanium violet': '#7B68EE',
  'titanium yellow': '#FFD700',
  'navy': '#001F3F',
  'silver shadow': '#C0C0C0',
  'mint': '#98FF98',
  'ice blue': '#99CCFF',
  'onyx black': '#1D1D1F',
  'marble gray': '#808080',
  'cobalt violet': '#6B3FA0',
  'amber yellow': '#FFBF00',
  'phantom black': '#1D1D1F',
  'icy blue': '#99CCFF',
  'cream': '#FFFDD0',
  'graphite': '#383838',
  'lavender': '#E6E6FA',
  'awesome graphite': '#383838',
  'awesome violet': '#9B59B6',
  'awesome lime': '#32CD32',
  'awesome white': '#FAFAFA',
  // Google Pixel colors
  'obsidian': '#1D1D1F',
  'porcelain': '#F5F5F5',
  'hazel': '#8B7355',
  'rose quartz': '#AA98A9',
  'bay': '#5F9EA0',
  'wintergreen': '#98FF98',
  'peony': '#DE6FA1',
  'rose': '#FF007F',
};

function getColorHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  return COLOR_MAP[normalized] || '#808080';
}

function renderColorSwatches(colors: string[] | undefined, selectedColor?: string): string {
  if (!colors || colors.length === 0) return '';
  
  // Limit to first 4 colors
  const displayColors = colors.slice(0, 4);
  const selectedIdx = selectedColor ? displayColors.findIndex(c => c === selectedColor) : 0;
  
  return `
    <div class="color-selector">
      <div class="color-name">${displayColors[selectedIdx >= 0 ? selectedIdx : 0]}</div>
      <div class="color-swatches">
        ${displayColors.map((color, idx) => `
          <button class="color-swatch ${idx === (selectedIdx >= 0 ? selectedIdx : 0) ? 'active' : ''}" 
                  data-color="${color}" 
                  style="background-color: ${getColorHex(color)}"
                  title="${color}">
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderStorageOptions(storage: string | undefined, storagePrices: string | undefined, basePrice: number): string {
  if (!storage) return '';
  
  const options = String(storage).split('|').map(s => s.trim());
  if (options.length === 0) return '';
  
  // Parse storage prices
  const priceMap: Record<string, number> = {};
  if (storagePrices) {
    String(storagePrices).split('|').forEach(item => {
      const [size, increment] = item.split(':');
      priceMap[size.trim()] = parseInt(increment) || 0;
    });
  }
  
  return `
    <div class="storage-selector">
      <div class="storage-label">Storage</div>
      <div class="storage-options">
        ${options.map((opt, idx) => {
          const increment = priceMap[opt] || 0;
          const totalPrice = basePrice + increment;
          return `
            <button class="storage-option ${idx === 0 ? 'active' : ''}" 
                    data-storage="${opt}" 
                    data-price-increment="${increment}"
                    data-total-price="${totalPrice}">
              ${opt}${increment > 0 ? ` <span class="storage-price">+$${increment}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ============================================================
// CAROUSEL NAVIGATION
// ============================================================

function setupCarousel(totalItems: number): void {
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  
  setTimeout(() => {
    const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
    const track = document.getElementById("carousel-track");
    const dotsContainer = document.getElementById("page-dots");
    
    if (!prevBtn || !nextBtn || !track) return;
    
    function updateCarousel() {
      const offset = currentPage * ITEMS_PER_PAGE * 276; // card width + gap
      track!.style.transform = `translateX(-${offset}px)`;
      
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage >= totalPages - 1;
      
      // Update dots
      if (dotsContainer) {
        dotsContainer.querySelectorAll(".page-dot").forEach((dot, i) => {
          dot.classList.toggle("active", i === currentPage);
        });
      }
    }
    
    prevBtn.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        updateCarousel();
      }
    });
    
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages - 1) {
        currentPage++;
        updateCarousel();
      }
    });
    
    // Dot navigation
    if (dotsContainer) {
      dotsContainer.querySelectorAll(".page-dot").forEach((dot, i) => {
        dot.addEventListener("click", () => {
          currentPage = i;
          updateCarousel();
        });
      });
    }
    
    updateCarousel();
  }, 100);
}

function setupColorSwatches(): void {
  document.querySelectorAll(".color-swatch").forEach(swatch => {
    swatch.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const colorName = target.dataset.color;
      const card = target.closest(".product-card");
      
      if (card && colorName) {
        // Update active state
        card.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
        target.classList.add("active");
        
        // Update color name display
        const nameDisplay = card.querySelector(".color-name");
        if (nameDisplay) {
          nameDisplay.textContent = colorName;
        }
        
        // Store selected color on card
        (card as HTMLElement).dataset.selectedColor = colorName;
      }
    });
  });
}

function setupStorageOptions(): void {
  document.querySelectorAll(".storage-option").forEach(option => {
    option.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      // Handle click on the price span inside the button
      const button = target.closest(".storage-option") as HTMLElement;
      if (!button) return;
      
      const storage = button.dataset.storage;
      const priceIncrement = parseInt(button.dataset.priceIncrement || "0");
      const card = button.closest(".product-card") as HTMLElement;
      
      if (card && storage) {
        // Update active state
        card.querySelectorAll(".storage-option").forEach(s => s.classList.remove("active"));
        button.classList.add("active");
        
        // Store selected storage on card
        card.dataset.selectedStorage = storage;
        
        // Update price display
        const basePrice = parseFloat(card.dataset.basePrice || "0");
        const newPrice = basePrice + priceIncrement;
        const newMonthly = newPrice / 36;
        
        const priceEl = card.querySelector(".product-price");
        const monthlyEl = card.querySelector(".product-monthly");
        
        if (priceEl) {
          priceEl.textContent = `$${newPrice.toLocaleString()}`;
        }
        if (monthlyEl) {
          monthlyEl.textContent = `$${newMonthly.toFixed(2)}/mo × 36`;
        }
      }
    });
  });
}

function renderPageDots(totalItems: number): string {
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  if (totalPages <= 1) return "";
  
  return `
    <div class="page-dots" id="page-dots">
      ${Array.from({ length: totalPages }, (_, i) => 
        `<div class="page-dot ${i === 0 ? 'active' : ''}" data-page="${i}"></div>`
      ).join("")}
    </div>
  `;
}

// ============================================================
// RENDERERS
// ============================================================

function renderPhones(products: Product[]): string {
  if (!products?.length) {
    return `
      <div class="header"><h1>📱 AT&T Phones</h1></div>
      <div class="empty-state">No phones found.</div>
    `;
  }

  currentPage = 0;
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);

  const html = `
    <div class="header">
      <div>
        <h1>📱 AT&T Phones</h1>
        <p>Found ${products.length} phones</p>
      </div>
      <div class="nav-info">Page ${currentPage + 1} of ${totalPages}</div>
    </div>
    ${selectedStore ? `
    <div class="pickup-banner">
      <span class="pickup-banner-icon">📍</span>
      <span class="pickup-banner-text">Pickup at <strong>${selectedStore.name || "AT&T Store"}</strong> — ${selectedStore.city || ""}, ${selectedStore.state || ""}</span>
      <button class="pickup-banner-clear" data-cross-action="clearStore">✕</button>
    </div>
    ` : ""}
    
    <div class="carousel-container">
      <button class="nav-btn prev" id="prev-btn" disabled>‹</button>
      <div class="carousel-wrapper">
        <div class="carousel-track" id="carousel-track">
          ${products.map(p => {
            const stock = getStockInfo(p.stock);
            const colors = p.colors || (p.color ? String(p.color).split('|').map(c => c.trim()) : []);
            const storageOpts = p.storage ? String(p.storage).split('|').map(s => s.trim()) : [];
            const defaultColor = colors[0] || '';
            const defaultStorage = storageOpts[0] || '';
            
            // Get default price (base price for first storage option)
            const basePrice = p.price;
            const monthlyBase = p.monthly_price || basePrice / 36;
            
            return `
              <div class="product-card" data-product-id="${p.product_id}" data-base-price="${basePrice}" data-selected-color="${defaultColor}" data-selected-storage="${defaultStorage}">
                <img src="${getProductImage(p)}" alt="${p.name}" class="product-image" />
                <span class="product-badge badge-phone">${p.subcategory || 'Phone'}</span>
                <div class="product-brand">${p.brand}</div>
                <div class="product-name">${p.name}</div>
                ${renderColorSwatches(colors)}
                ${renderStorageOptions(p.storage, p.storage_prices, basePrice)}
                <div class="product-price" data-base-price="${basePrice}">$${basePrice.toLocaleString()}</div>
                <div class="product-monthly" data-base-monthly="${monthlyBase.toFixed(2)}">$${monthlyBase.toFixed(2)}/mo × 36</div>
                <div class="product-rating">${"⭐".repeat(Math.floor(p.rating))} ${p.rating}</div>
                <span class="stock-badge ${stock.class}">${stock.label}</span>
                <button class="btn btn-primary add-to-cart" data-id="${p.product_id}" data-type="product" ${p.stock === 0 ? 'disabled' : ''}>
                  ${p.stock === 0 ? 'Out of Stock' : '🛒 Add to Cart'}
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <button class="nav-btn next" id="next-btn">›</button>
    </div>
    ${renderPageDots(products.length)}
  `;

  setTimeout(() => {
    setupCarousel(products.length);
    setupColorSwatches();
    setupStorageOptions();
  }, 0);
  return html;
}

function renderAccessories(products: Product[]): string {
  if (!products?.length) {
    return `
      <div class="header"><h1>🎧 AT&T Accessories</h1></div>
      <div class="empty-state">No accessories found.</div>
    `;
  }

  currentPage = 0;
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);

  const html = `
    <div class="header">
      <div>
        <h1>🎧 AT&T Accessories</h1>
        <p>Found ${products.length} accessories</p>
      </div>
      <div class="nav-info">Page ${currentPage + 1} of ${totalPages}</div>
    </div>
    
    <div class="carousel-container">
      <button class="nav-btn prev" id="prev-btn" disabled>‹</button>
      <div class="carousel-wrapper">
        <div class="carousel-track" id="carousel-track">
          ${products.map(p => {
            const stock = getStockInfo(p.stock);
            return `
              <div class="product-card">
                <img src="${getProductImage(p)}" alt="${p.name}" class="product-image" />
                <span class="product-badge badge-accessory">${p.subcategory || 'Accessory'}</span>
                <div class="product-brand">${p.brand}</div>
                <div class="product-name">${p.name}</div>
                <div class="product-price">$${p.price.toLocaleString()}</div>
                <div class="product-rating">${"⭐".repeat(Math.floor(p.rating))} ${p.rating}</div>
                <span class="stock-badge ${stock.class}">${stock.label}</span>
                <button class="btn btn-primary add-to-cart" data-id="${p.product_id}" data-type="product" ${p.stock === 0 ? 'disabled' : ''}>
                  ${p.stock === 0 ? 'Out of Stock' : '🛒 Add to Cart'}
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <button class="nav-btn next" id="next-btn">›</button>
    </div>
    ${renderPageDots(products.length)}
  `;

  setTimeout(() => setupCarousel(products.length), 0);
  return html;
}

function renderPlans(plans: Plan[]): string {
  if (!plans?.length) {
    return `
      <div class="header"><h1>📋 Wireless Plans</h1></div>
      <div class="empty-state">No plans found.</div>
    `;
  }

  currentPage = 0;
  const totalPages = Math.ceil(plans.length / ITEMS_PER_PAGE);

  const html = `
    <div class="header">
      <div>
        <h1>📋 AT&T Wireless Plans</h1>
        <p>Compare ${plans.length} plans</p>
      </div>
      <div class="nav-info">Page ${currentPage + 1} of ${totalPages}</div>
    </div>
    
    <div class="carousel-container">
      <button class="nav-btn prev" id="prev-btn" disabled>‹</button>
      <div class="carousel-wrapper">
        <div class="carousel-track" id="carousel-track">
          ${plans.map(p => {
            const isBYOD = p.category === 'BYOD';
            const isFamily = p.category === 'Family';
            const badgeClass = isBYOD ? 'badge-byod' : isFamily ? 'badge-family' : 'badge-plan';
            return `
              <div class="plan-card ${p.popular ? 'popular' : ''} ${isBYOD ? 'byod-plan' : ''}">
                ${p.popular ? '<div class="popular-tag">🏆 POPULAR</div>' : ''}
                <span class="product-badge ${badgeClass}">${p.category}</span>
                <div class="plan-name">${p.name}</div>
                <div class="plan-price">$${p.price_monthly}<span>/mo</span></div>
                ${isBYOD ? '<div class="byod-note">📱 Bring Your Own Device</div>' : ''}
                ${!isBYOD && p.category === 'Postpaid' ? '<div class="plan-note">📱 Requires phone for new customers</div>' : ''}
                <ul class="plan-features">
                  <li>📊 ${p.data_limit}</li>
                  <li>📶 Hotspot: ${p.hotspot || 'None'}</li>
                  <li>📺 ${p.streaming || 'SD'} streaming</li>
                </ul>
                <button class="btn btn-primary add-to-cart" data-id="${p.plan_id}" data-type="plan">
                  ✓ Select Plan
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <button class="nav-btn next" id="next-btn">›</button>
    </div>
    ${renderPageDots(plans.length)}
  `;

  setTimeout(() => setupCarousel(plans.length), 0);
  return html;
}

function renderInternet(data: InternetPlan[] | InternetResponse): string {
  // Handle both array of plans and response object with qualification
  let plans: InternetPlan[];
  let qualificationStatus: InternetResponse['qualification_status'] | null = null;
  let planType = "Internet";
  
  if (Array.isArray(data)) {
    plans = data;
  } else {
    plans = data.plans || [];
    qualificationStatus = data.qualification_status || null;
    planType = data.plan_type || (plans[0]?.category || "Internet");
  }
  
  if (!plans?.length) {
    return `
      <div class="header">
        <h1>🌐 AT&T Internet</h1>
        <p>Check your address to see available plans</p>
      </div>
      <div class="empty-state">
        <p>📍 Please provide your address to see available internet plans.</p>
        <p style="margin-top: 12px; font-size: 0.9rem;">Tell Claude your address and ZIP code to check availability.</p>
      </div>
    `;
  }

  const isFiber = planType === "Fiber" || plans[0]?.category === "Fiber";
  
  currentPage = 0;
  const totalPages = Math.ceil(plans.length / ITEMS_PER_PAGE);

  const html = `
    <div class="header" style="background: ${isFiber ? 'linear-gradient(135deg, #0057b8 0%, #00d4ff 100%)' : 'linear-gradient(135deg, #7c3aed 0%, #00a8e8 100%)'}">
      <div>
        <h1>${isFiber ? '⚡ AT&T Fiber' : '📡 AT&T Internet Air'}</h1>
        <p>Found ${plans.length} plans${qualificationStatus ? ` for ${qualificationStatus.address}` : ''}</p>
      </div>
      <div class="nav-info">Page ${currentPage + 1} of ${totalPages}</div>
    </div>
    
    ${qualificationStatus ? `
      <div class="qualification-banner ${isFiber ? 'fiber' : 'air'}">
        <span class="qual-icon">${isFiber ? '🎉' : '📶'}</span>
        <div class="qual-text">
          <strong>${isFiber ? 'AT&T Fiber is available!' : 'AT&T Internet Air is available!'}</strong>
          <span>${qualificationStatus.address}, ${qualificationStatus.zip}</span>
        </div>
        <span class="qual-check">✓ Qualified</span>
      </div>
    ` : ''}
    
    <div class="carousel-container">
      <button class="nav-btn prev" id="prev-btn" disabled>‹</button>
      <div class="carousel-wrapper">
        <div class="carousel-track" id="carousel-track">
          ${plans.map(p => {
            const isPlanFiber = p.category === "Fiber";
            const speedNum = p.speed_down.replace(/[^0-9]/g, '');
            const isGig = parseInt(speedNum) >= 1000 || p.speed_down.toLowerCase().includes('gig');
            const displaySpeed = isGig ? (parseInt(speedNum) >= 1000 ? Math.floor(parseInt(speedNum)/1000) : speedNum) : speedNum;
            const speedUnit = isGig ? 'GIG' : 'Mbps';
            
            return `
              <div class="product-card">
                ${p.popular ? '<div class="popular-tag">⭐ RECOMMENDED</div>' : ''}
                
                <div class="product-image internet-hero ${isPlanFiber ? 'fiber-gradient' : 'air-gradient'}">
                  <div class="speed-badge-large">
                    <span class="speed-number">${displaySpeed}</span>
                    <span class="speed-label">${speedUnit}</span>
                  </div>
                  <div class="internet-icon">${isPlanFiber ? '⚡' : '📡'}</div>
                </div>
                
                <span class="product-badge ${isPlanFiber ? 'badge-fiber' : 'badge-air'}">${p.category}</span>
                <div class="product-brand">${isPlanFiber ? 'FIBER OPTIC' : '5G HOME INTERNET'}</div>
                <div class="product-name">${p.name}</div>
                
                <div class="product-price">$${p.price_monthly}<span style="font-size: 0.9rem; font-weight: 400;">/mo</span></div>
                <div class="product-monthly">+ taxes & equipment</div>
                
                <div class="product-rating">
                  <span class="speed-detail">⬇️ ${p.speed_down}</span>
                  <span class="speed-detail">⬆️ ${p.speed_up}</span>
                </div>
                
                <span class="stock-badge stock-high">${isPlanFiber ? '✓ No data caps' : '✓ No installation'}</span>
                
                <button class="btn btn-primary add-to-cart" data-id="${p.plan_id}" data-type="internet">
                  🛒 Add to Cart
                </button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <button class="nav-btn next" id="next-btn">›</button>
    </div>
    ${renderPageDots(plans.length)}
  `;

  setTimeout(() => setupCarousel(plans.length), 0);
  return html;
}

function renderCart(cart: CartData): string {
  const hasHistory = navigationHistory.length > 0;
  
  if (!cart || cart.item_count === 0) {
    return `
      <div class="header">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${hasHistory ? `<button class="back-btn" id="back-btn">← Back</button>` : ''}
          <div>
            <h1>🛒 Your Cart</h1>
            <p>Empty</p>
          </div>
        </div>
      </div>
      <div class="empty-state">
        <p>Your cart is empty. Add some products!</p>
        ${hasHistory ? `<button class="btn btn-primary" id="continue-shopping" style="margin-top: 16px;">← Continue Shopping</button>` : ''}
      </div>
    `;
  }

  return `
    <div class="header">
      <div style="display: flex; align-items: center; gap: 12px;">
        ${hasHistory ? `<button class="back-btn" id="back-btn">← Back</button>` : ''}
        <div>
          <h1>🛒 Your Cart</h1>
          <p>${cart.item_count} item${cart.item_count > 1 ? 's' : ''}</p>
        </div>
      </div>
    </div>
    ${selectedStore ? `
    <div class="pickup-banner pickup-banner-cart">
      <span class="pickup-banner-icon">📦</span>
      <div class="pickup-banner-info">
        <span class="pickup-banner-text"><strong>In-Store Pickup</strong> at ${selectedStore.name || "AT&T Store"}</span>
        <span class="pickup-banner-address">${selectedStore.address1 || ""}, ${selectedStore.city || ""} ${selectedStore.state || ""}</span>
      </div>
      <button class="pickup-banner-clear" data-cross-action="clearStore">✕</button>
    </div>
    ` : ""}
    
    <div class="cart-layout">
      <div class="cart-items">
        ${cart.items.map(item => {
          const hasOptions = item.color || item.storage;
          return `
            <div class="cart-item">
              <div class="cart-item-details">
                <h4>${item.name}</h4>
                ${hasOptions ? `
                  <div class="cart-item-options">
                    ${item.color ? `<span class="cart-option"><span class="option-swatch" style="background-color: ${getColorHex(item.color)}"></span>${item.color}</span>` : ''}
                    ${item.storage ? `<span class="cart-option">💾 ${item.storage}</span>` : ''}
                  </div>
                ` : ''}
                <div class="qty">Qty: ${item.quantity} × $${item.price.toFixed(2)}</div>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <div class="price">$${(item.price * item.quantity).toFixed(2)}</div>
                <button class="btn btn-danger remove-item" data-id="${item.id}" style="width: auto; padding: 8px 12px;">
                  ✕
                </button>
              </div>
            </div>
          `;
        }).join("")}
        
        ${hasHistory ? `
          <button class="btn btn-secondary" id="continue-shopping" style="margin-top: 16px;">
            ← Continue Shopping
          </button>
        ` : ''}
      </div>
      
      <div class="cart-summary">
        <h3 style="margin-bottom: 16px;">Summary</h3>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>$${cart.subtotal.toFixed(2)}</span>
        </div>
        ${cart.discount > 0 ? `
          <div class="summary-row discount">
            <span>Discount ${cart.promo_code ? `(${cart.promo_code})` : ''}</span>
            <span>-$${cart.discount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="summary-row">
          <span>Tax</span>
          <span>$${cart.tax.toFixed(2)}</span>
        </div>
        <div class="summary-row">
          <span>Shipping</span>
          <span>${cart.shipping === 0 ? 'FREE' : `$${cart.shipping.toFixed(2)}`}</span>
        </div>
        <div class="summary-row total">
          <span>Total</span>
          <span>$${cart.total.toFixed(2)}</span>
        </div>
        
        <div class="promo-row">
          <input type="text" id="promo-input" placeholder="Promo code" />
          <button class="btn btn-primary" id="apply-promo" style="width: auto;">Apply</button>
        </div>
        
        <div class="customer-type-section">
          <label class="customer-type-label">Are you a new or existing AT&T customer?</label>
          <div class="customer-type-options">
            <button class="customer-type-btn active" data-type="new">
              <span class="type-icon">🆕</span>
              <span class="type-text">New Customer</span>
            </button>
            <button class="customer-type-btn" data-type="existing">
              <span class="type-icon">👤</span>
              <span class="type-text">Existing Customer</span>
            </button>
          </div>
          <p class="customer-type-note" id="customer-note">New customers: Phone + Plan required for Unlimited plans</p>
        </div>
        
        <button class="btn btn-success" id="checkout-btn" style="margin-top: 16px;">
          Checkout →
        </button>
      </div>
    </div>
  `;
}

function renderInventory(summary: InventorySummary): string {
  const categories = Object.entries(summary.by_category);
  const brands = Object.entries(summary.by_brand).slice(0, 6);

  return `
    <div class="header">
      <div>
        <h1>📊 Inventory Dashboard</h1>
        <p>Real-time overview</p>
      </div>
      <button class="btn btn-primary" id="refresh-inventory" style="width: auto;">🔄 Refresh</button>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${summary.total_products}</div>
        <div class="stat-label">Products</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${summary.total_stock.toLocaleString()}</div>
        <div class="stat-label">Total Units</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${(summary.total_value / 1000000).toFixed(1)}M</div>
        <div class="stat-label">Value</div>
      </div>
      <div class="stat-card ${summary.low_stock > 0 ? 'warning' : ''}">
        <div class="stat-value">${summary.low_stock}</div>
        <div class="stat-label">Low Stock</div>
      </div>
      <div class="stat-card ${summary.out_of_stock > 0 ? 'danger' : ''}">
        <div class="stat-value">${summary.out_of_stock}</div>
        <div class="stat-label">Out of Stock</div>
      </div>
    </div>
    
    <div class="breakdown-grid">
      <div class="breakdown-card">
        <h3>📦 By Category</h3>
        ${categories.map(([cat, count]) => `
          <div class="breakdown-row">
            <span>${cat}</span>
            <span>${count}</span>
          </div>
        `).join("")}
      </div>
      <div class="breakdown-card">
        <h3>🏷️ By Brand</h3>
        ${brands.map(([brand, count]) => `
          <div class="breakdown-row">
            <span>${brand}</span>
            <span>${count}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

// ============================================================
// STORE LOCATOR WIDGET
// ============================================================

function formatStoreTime(timeStr: string): string {
  if (!timeStr) return "";
  // Handle various formats: "0900", "09:00", "9:00 AM", "09:00:00", etc.
  const cleaned = timeStr.trim();
  
  // Already has AM/PM
  if (/[aApP][mM]/.test(cleaned)) return cleaned;
  
  // "HH:MM:SS" or "HH:MM"
  const colonMatch = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    let h = parseInt(colonMatch[1]);
    const m = colonMatch[2];
    const ampm = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }
  
  // "HHMM" (4-digit military)
  const milMatch = cleaned.match(/^(\d{2})(\d{2})$/);
  if (milMatch) {
    let h = parseInt(milMatch[1]);
    const m = milMatch[2];
    const ampm = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }
  
  return cleaned; // Return as-is if we can't parse
}

function getStoreHoursForDay(store: StoreLocation, dayIndex: number): { open: string; close: string } {
  // dayIndex: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = dayNames[dayIndex];
  const s = store as Record<string, unknown>;
  
  // Try multiple possible field name patterns
  const openVal = 
    s[`${dayName}open`] || s[`${dayName}Open`] || s[`${dayName}_open`] ||
    s[`${dayName}start`] || s[`${dayName}Start`] || s[`${dayName}_start`] ||
    s[`open_${dayName}`] || s[`start_${dayName}`] || "";
  const closeVal = 
    s[`${dayName}close`] || s[`${dayName}Close`] || s[`${dayName}_close`] ||
    s[`${dayName}end`] || s[`${dayName}End`] || s[`${dayName}_end`] ||
    s[`close_${dayName}`] || s[`end_${dayName}`] || "";
  
  return {
    open: String(openVal || "").trim(),
    close: String(closeVal || "").trim(),
  };
}

// Check if a store has ANY hours data at all
function storeHasHoursData(store: StoreLocation): boolean {
  const s = store as Record<string, unknown>;
  const hourKeyPatterns = ["open", "close", "start", "end"];
  const dayPatterns = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  
  for (const key of Object.keys(s)) {
    const kl = key.toLowerCase();
    for (const d of dayPatterns) {
      for (const h of hourKeyPatterns) {
        if (kl.includes(d) && kl.includes(h) && s[key]) return true;
      }
    }
  }
  // Also check generic "hours" field
  if (s.hours && String(s.hours).trim()) return true;
  return false;
}

// Parse a generic "hours" string like "Mon-Fri: 9am-8pm, Sat: 10am-6pm, Sun: Closed"
function parseGenericHours(hoursStr: string): { day: string; hours: string }[] | null {
  if (!hoursStr || hoursStr.trim().length === 0) return null;
  // Return as a single-row "raw" display
  return [{ day: "Hours", hours: hoursStr }];
}

function getStoreTypeLabel(vtype?: string): string {
  if (vtype === "122") return "Company Store";
  if (vtype === "4") return "Authorized Retailer";
  return "AT&T Store";
}

function getStoreTypeBadgeClass(vtype?: string): string {
  if (vtype === "122") return "store-badge-company";
  if (vtype === "4") return "store-badge-authorized";
  return "store-badge-company";
}

function getDayHours(store: StoreLocation): { day: string; hours: string }[] {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayIndices = [1, 2, 3, 4, 5, 6, 0]; // Mon=1 through Sun=0
  
  // First check if we have per-day fields
  if (storeHasHoursData(store)) {
    return dayLabels.map((label, i) => {
      const h = getStoreHoursForDay(store, dayIndices[i]);
      if (h.open && h.close) {
        return { day: label, hours: `${formatStoreTime(h.open)} – ${formatStoreTime(h.close)}` };
      }
      return { day: label, hours: "Closed" };
    });
  }
  
  // Fallback: check generic "hours" field
  const s = store as Record<string, unknown>;
  if (s.hours && String(s.hours).trim()) {
    const parsed = parseGenericHours(String(s.hours));
    if (parsed) return parsed;
  }
  
  // No hours data at all — return empty (not "Closed" for every day)
  return [];
}

function getTodayHours(store: StoreLocation): { text: string; isOpen: boolean } {
  const now = new Date();
  const dayIndex = now.getDay(); // 0=Sun, 1=Mon, ...
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // First check per-day fields
  if (storeHasHoursData(store)) {
    const h = getStoreHoursForDay(store, dayIndex);
    if (h.open && h.close) {
      const openFormatted = formatStoreTime(h.open);
      const closeFormatted = formatStoreTime(h.close);
      
      // Try to determine if currently open
      const openMin = parseTimeToMinutes(h.open);
      const closeMin = parseTimeToMinutes(h.close);
      
      if (openMin !== null && closeMin !== null) {
        const isOpen = currentMinutes >= openMin && currentMinutes < closeMin;
        if (isOpen) {
          return { text: `Open · Closes ${closeFormatted}`, isOpen: true };
        } else if (currentMinutes < openMin) {
          return { text: `Closed · Opens ${openFormatted}`, isOpen: false };
        } else {
          return { text: `Closed · Opened ${openFormatted} – ${closeFormatted}`, isOpen: false };
        }
      }
      
      return { text: `${openFormatted} – ${closeFormatted}`, isOpen: true };
    }
    return { text: "Closed today", isOpen: false };
  }
  
  // Fallback: generic hours field
  const s = store as Record<string, unknown>;
  if (s.hours && String(s.hours).trim()) {
    return { text: String(s.hours), isOpen: true }; // Assume open if we have hours text
  }
  
  return { text: "Hours unavailable", isOpen: false };
}

// Convert time string to minutes since midnight for comparison
function parseTimeToMinutes(timeStr: string): number | null {
  const cleaned = timeStr.trim();
  
  // "HH:MM AM/PM"
  const ampmMatch = cleaned.match(/(\d{1,2}):(\d{2})\s*([aApP][mM])/);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1]);
    const m = parseInt(ampmMatch[2]);
    const isPM = /[pP]/.test(ampmMatch[3]);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return h * 60 + m;
  }
  
  // "HH:MM" (24h)
  const colonMatch = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  }
  
  // "HHMM"
  const milMatch = cleaned.match(/^(\d{2})(\d{2})$/);
  if (milMatch) {
    return parseInt(milMatch[1]) * 60 + parseInt(milMatch[2]);
  }
  
  return null;
}

function renderStoreMap(stores: StoreLocation[]): string {
  if (!stores.length) return "";

  // Build map pins for all stores
  const validStores = stores.filter(s => s.latitude && s.longitude);
  if (!validStores.length) return `<div class="store-map-placeholder"><p>📍 Map unavailable — no coordinates found</p></div>`;

  // Calculate map bounds
  const lats = validStores.map(s => s.latitude!);
  const lngs = validStores.map(s => s.longitude!);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), 0.02);
  const lngSpan = Math.max(Math.max(...lngs) - Math.min(...lngs), 0.02);

  // Generate SVG map with pins
  const mapWidth = 600;
  const mapHeight = 300;
  const padding = 40;

  const pins = validStores.map((store, i) => {
    const x = padding + ((store.longitude! - (centerLng - lngSpan / 2)) / lngSpan) * (mapWidth - 2 * padding);
    const y = padding + ((1 - (store.latitude! - (centerLat - latSpan / 2)) / latSpan)) * (mapHeight - 2 * padding);
    const isSelected = i === selectedStoreIndex;
    const pinSize = isSelected ? 14 : 10;
    const color = isSelected ? "#0057b8" : (store.vtype === "122" ? "#00a8e8" : "#f59e0b");

    return `
      <g class="store-pin" data-store-idx="${i}" style="cursor:pointer">
        <circle cx="${x}" cy="${y}" r="${pinSize + 4}" fill="${isSelected ? "rgba(0,87,184,0.15)" : "transparent"}" />
        <circle cx="${x}" cy="${y}" r="${pinSize}" fill="${color}" stroke="white" stroke-width="2.5" />
        <text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="${isSelected ? 10 : 8}" font-weight="700">${i + 1}</text>
        ${isSelected ? `<circle cx="${x}" cy="${y}" r="${pinSize + 8}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.6"><animateTransform attributeName="transform" type="rotate" from="0 ${x} ${y}" to="360 ${x} ${y}" dur="8s" repeatCount="indefinite"/></circle>` : ""}
      </g>
    `;
  }).join("");

  return `
    <div class="store-map-container">
      <svg viewBox="0 0 ${mapWidth} ${mapHeight}" class="store-map-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="mapBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#f0f7ff"/>
            <stop offset="100%" style="stop-color:#e8f4f8"/>
          </linearGradient>
          <filter id="pinShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.2"/>
          </filter>
        </defs>
        <rect width="${mapWidth}" height="${mapHeight}" fill="url(#mapBg)" rx="12"/>
        
        <!-- Grid lines -->
        ${Array.from({length: 5}, (_, i) => {
          const y = padding + (i / 4) * (mapHeight - 2 * padding);
          return `<line x1="${padding}" y1="${y}" x2="${mapWidth - padding}" y2="${y}" stroke="#d0dfe8" stroke-width="0.5" stroke-dasharray="4,4"/>`;
        }).join("")}
        ${Array.from({length: 7}, (_, i) => {
          const x = padding + (i / 6) * (mapWidth - 2 * padding);
          return `<line x1="${x}" y1="${padding}" x2="${x}" y2="${mapHeight - padding}" stroke="#d0dfe8" stroke-width="0.5" stroke-dasharray="4,4"/>`;
        }).join("")}
        
        <!-- Distance lines connecting pins -->
        ${validStores.length > 1 ? validStores.slice(0, -1).map((store, i) => {
          const nextStore = validStores[i + 1];
          const x1 = padding + ((store.longitude! - (centerLng - lngSpan / 2)) / lngSpan) * (mapWidth - 2 * padding);
          const y1 = padding + ((1 - (store.latitude! - (centerLat - latSpan / 2)) / latSpan)) * (mapHeight - 2 * padding);
          const x2 = padding + ((nextStore.longitude! - (centerLng - lngSpan / 2)) / lngSpan) * (mapWidth - 2 * padding);
          const y2 = padding + ((1 - (nextStore.latitude! - (centerLat - latSpan / 2)) / latSpan)) * (mapHeight - 2 * padding);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0057b8" stroke-width="1" stroke-dasharray="6,4" opacity="0.2"/>`;
        }).join("") : ""}
        
        <g filter="url(#pinShadow)">${pins}</g>
      </svg>
      <div class="map-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#00a8e8"></span> Company Store</span>
        <span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span> Authorized Retailer</span>
      </div>
    </div>
  `;
}

function renderStores(data: StoreSearchResult): string {
  const stores = data.stores || [];
  const location = data.searchLocation || data.searchPostal || "your area";

  if (!stores.length) {
    const errorDetail = data.error || data.message || "";
    const hasApiError = data.success === false;
    return `
      <div class="header">
        <div>
          <h1>📍 AT&T Store Locator</h1>
          <p>Find stores near you</p>
        </div>
      </div>
      <div class="store-empty">
        <div class="store-empty-icon">${hasApiError ? "⚠️" : "🏪"}</div>
        <h3>${hasApiError ? "Unable to reach AT&T Store API" : `No stores found near ${location}`}</h3>
        <p>${errorDetail || "Try a different ZIP code or increase the search radius."}</p>
        ${hasApiError ? `<p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;">The store locator API may be blocked by network settings.<br/>You can search directly on the AT&T website instead.</p>` : ""}
        <a href="https://www.att.com/stores/${data.searchPostal ? "?q=" + data.searchPostal : ""}" target="_blank" class="btn btn-primary" style="display:inline-block;margin-top:12px;text-decoration:none">
          Search on att.com/stores →
        </a>
      </div>
    `;
  }

  const selectedStore = stores[selectedStoreIndex] || stores[0];
  const address = [selectedStore.address1, selectedStore.address2].filter(Boolean).join(", ");
  const cityStateZip = [selectedStore.city, selectedStore.state].filter(Boolean).join(", ") + (selectedStore.postalcode ? ` ${selectedStore.postalcode}` : "");
  const todayHours = getTodayHours(selectedStore);
  const allHours = getDayHours(selectedStore);
  const storeType = getStoreTypeLabel(selectedStore.vtype);

  // Build store list cards
  const storeListHtml = stores.map((store, i) => {
    const dist = store.distance ? `${store.distance.toFixed(1)} mi` : "";
    const isActive = i === selectedStoreIndex;
    const stType = getStoreTypeLabel(store.vtype);
    const badgeClass = getStoreTypeBadgeClass(store.vtype);
    const stAddress = [store.address1].filter(Boolean).join(", ");
    const stCity = [store.city, store.state].filter(Boolean).join(", ");
    const stHours = getTodayHours(store);

    return `
      <div class="store-list-card ${isActive ? "store-list-card-active" : ""}" data-store-select="${i}">
        <div class="store-list-number">${i + 1}</div>
        <div class="store-list-info">
          <div class="store-list-name">${store.name || store.mystore_name || "AT&T Store"}</div>
          <span class="store-type-badge ${badgeClass}">${stType}</span>
          <div class="store-list-address">${stAddress}<br/>${stCity}</div>
          <div class="store-list-meta">
            ${dist ? `<span class="store-meta-item">📏 ${dist}</span>` : ""}
            <span class="store-meta-item store-hours-status ${stHours.isOpen ? "store-open" : "store-closed"}">${stHours.isOpen ? "●" : "●"} ${stHours.text}</span>
          </div>
        </div>
        <div class="store-list-arrow">${isActive ? "◀" : "›"}</div>
      </div>
    `;
  }).join("");

  // Build detail panel for selected store
  const hoursHtml = allHours.length > 0 
    ? allHours.map(h => {
        const isClosed = h.hours === "Closed";
        return `<div class="hours-row"><span class="hours-day">${h.day}</span><span class="hours-time ${isClosed ? "hours-closed" : ""}">${h.hours}</span></div>`;
      }).join("")
    : `<div class="hours-row"><span class="hours-day" style="color:var(--text-muted)">Hours not provided by this location</span></div>`;

  const servicesHtml = selectedStore.services 
    ? selectedStore.services.split(",").map(s => 
        `<span class="service-chip">${s.trim()}</span>`
      ).join("")
    : `<span class="service-chip">Retail</span><span class="service-chip">Trade-In</span><span class="service-chip">Support</span>`;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address + ", " + cityStateZip)}`;
  const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${selectedStore.latitude},${selectedStore.longitude}`;

  return `
    <div class="header">
      <div>
        <h1>📍 AT&T Store Locator</h1>
        <p>${stores.length} store${stores.length !== 1 ? "s" : ""} near ${location}</p>
      </div>
      <div class="nav-info">${stores.length} found</div>
    </div>

    ${renderStoreMap(stores)}

    <div class="store-layout">
      <!-- Store List (Left) -->
      <div class="store-list-panel">
        <div class="store-list-header">Nearby Stores</div>
        ${storeListHtml}
      </div>

      <!-- Store Detail (Right) -->
      <div class="store-detail-panel">
        <div class="store-detail-header">
          <div class="store-detail-name">${selectedStore.name || selectedStore.mystore_name || "AT&T Store"}</div>
          <span class="store-type-badge ${getStoreTypeBadgeClass(selectedStore.vtype)}">${storeType}</span>
        </div>
        
        <div class="store-detail-section">
          <div class="store-detail-label">📍 Address</div>
          <div class="store-detail-value">
            ${address}<br/>${cityStateZip}
          </div>
        </div>

        ${selectedStore.phone ? `
        <div class="store-detail-section">
          <div class="store-detail-label">📞 Phone</div>
          <div class="store-detail-value"><a href="tel:${selectedStore.phone}" class="store-phone-link">${selectedStore.phone}</a></div>
        </div>` : ""}

        ${selectedStore.distance ? `
        <div class="store-detail-section">
          <div class="store-detail-label">📏 Distance</div>
          <div class="store-detail-value">${selectedStore.distance.toFixed(1)} miles away</div>
        </div>` : ""}

        <div class="store-detail-section">
          <div class="store-detail-label">🕐 Today's Hours</div>
          <div class="store-detail-value store-today-hours ${todayHours.isOpen ? "store-open" : "store-closed"}">
            <span class="store-status-dot ${todayHours.isOpen ? "dot-open" : "dot-closed"}">●</span>
            ${todayHours.text}
          </div>
        </div>

        ${allHours.length > 0 ? `
        <div class="store-detail-section store-hours-toggle" data-expanded="false">
          <div class="store-detail-label store-hours-btn" id="toggle-hours">📅 Full Hours <span class="toggle-arrow">▼</span></div>
          <div class="store-hours-grid" style="display:none">
            ${hoursHtml}
          </div>
        </div>
        ` : ""}

        <div class="store-detail-section">
          <div class="store-detail-label">🔧 Services</div>
          <div class="store-services-wrap">${servicesHtml}</div>
        </div>

        ${selectedStore.id ? `
        <div class="store-detail-section store-ids">
          <span class="store-id-chip">ID: ${selectedStore.id}</span>
          ${selectedStore.opus_id ? `<span class="store-id-chip">OPUS: ${selectedStore.opus_id}</span>` : ""}
          ${selectedStore.inv_id ? `<span class="store-id-chip">INV: ${selectedStore.inv_id}</span>` : ""}
        </div>` : ""}

        <div class="store-actions">
          <a href="${mapsUrl}" target="_blank" class="btn btn-primary store-action-btn">
            🧭 Get Directions
          </a>
          ${selectedStore.phone ? `<a href="tel:${selectedStore.phone}" class="btn btn-secondary store-action-btn">📞 Call Store</a>` : ""}
          <a href="${mapsSearchUrl}" target="_blank" class="btn btn-secondary store-action-btn">🗺️ View on Map</a>
        </div>

        <!-- Cross-widget actions -->
        <div class="store-actions" style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border-light, #e5e7eb)">
          <button class="btn btn-primary store-action-btn" data-cross-action="setPickup" data-store-idx="${selectedStoreIndex}">
            📦 Set as Pickup Store
          </button>
          <button class="btn btn-secondary store-action-btn" data-cross-action="shopAtStore" data-store-idx="${selectedStoreIndex}">
            🛍️ Browse Phones
          </button>
          <button class="btn btn-secondary store-action-btn" data-cross-action="viewCart">
            🛒 View Cart
          </button>
        </div>
      </div>
    </div>

    <div class="store-footer">
      <a href="https://www.att.com/stores/${selectedStore.postalcode ? "?q=" + selectedStore.postalcode : ""}" target="_blank">
        🌐 View all stores on att.com/stores
      </a>
    </div>
  `;
}

// ============================================================
// MAIN RENDER
// ============================================================

function render(): void {
  if (!currentData) {
    appContainer.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    `;
    return;
  }

  let html = "";
  switch (currentView) {
    case "phones": html = renderPhones(currentData as Product[]); break;
    case "accessories": html = renderAccessories(currentData as Product[]); break;
    case "plans": html = renderPlans(currentData as Plan[]); break;
    case "internet": html = renderInternet(currentData as InternetPlan[] | InternetResponse); break;
    case "cart": html = renderCart(currentData as CartData); break;
    case "inventory": html = renderInventory(currentData as InventorySummary); break;
    case "stores": html = renderStores(currentData as StoreSearchResult); break;
  }

  appContainer.innerHTML = html;
  attachEventListeners();
}

// ============================================================
// EVENT HANDLERS
// ============================================================

function attachEventListeners(): void {
  // Back button handler
  const backBtn = document.getElementById("back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      goBack();
    });
  }
  
  // Continue shopping button handler
  const continueShoppingBtn = document.getElementById("continue-shopping");
  if (continueShoppingBtn) {
    continueShoppingBtn.addEventListener("click", () => {
      goBack();
    });
  }

  // Add to cart - Show toast notification in UI
  document.querySelectorAll(".add-to-cart").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.disabled) return;
      
      const productId = target.dataset.id;
      const productType = target.dataset.type || "product";
      const card = target.closest(".product-card") as HTMLElement;
      const productName = card?.querySelector(".product-name, .plan-name")?.textContent || "Item";
      
      // Get selected color and storage from card data attributes
      const selectedColor = card?.dataset.selectedColor || "";
      const selectedStorage = card?.dataset.selectedStorage || "";
      
      if (productId) {
        const originalText = target.textContent;
        target.classList.add("loading");
        target.disabled = true;
        
        try {
          const result = await app.callServerTool({
            name: "add_to_cart",
            arguments: { 
              product_id: productId, 
              product_type: productType,
              color: selectedColor,
              storage: selectedStorage
            },
          });
          
          const text = extractResultText(result);
          const isSuccess = text && (text.includes("ITEM ADDED") || text.includes("✅"));
          
          if (isSuccess) {
            // Show success toast with options
            const optionsText = [selectedColor, selectedStorage].filter(Boolean).join(", ");
            showToast("success", "Added to Cart!", `${productName}${optionsText ? ` (${optionsText})` : ''} added.`);
            
            // Update button
            target.classList.remove("loading");
            target.textContent = "✓ Added!";
            target.classList.remove("btn-primary");
            target.classList.add("btn-success");
            
            // Refresh cart state
            fetchCartState();
            
            // Broadcast cart update to other widgets
            broadcastEvent({ type: "cart:updated", source: currentView, payload: cartState });
            
            setTimeout(() => {
              target.textContent = originalText;
              target.classList.remove("btn-success");
              target.classList.add("btn-primary");
              target.disabled = false;
            }, 2000);
          } else {
            throw new Error("Failed to add");
          }
        } catch (error) {
          target.classList.remove("loading");
          target.textContent = "Error";
          showToast("error", "Error", "Failed to add item to cart.");
          console.error(error);
          
          setTimeout(() => {
            target.textContent = originalText;
            target.disabled = false;
          }, 2000);
        }
      }
    });
  });

  // Remove from cart
  document.querySelectorAll(".remove-item").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const target = e.target as HTMLButtonElement;
      const productId = target.dataset.id;
      const itemCard = target.closest(".cart-item");
      const itemName = itemCard?.querySelector("h4")?.textContent || "Item";
      
      if (productId) {
        target.classList.add("loading");
        
        try {
          const result = await app.callServerTool({
            name: "remove_from_cart",
            arguments: { product_id: productId },
          });
          
          const text = extractResultText(result);
          const isSuccess = text && (text.includes("ITEM REMOVED") || text.includes("🗑️"));
          
          if (isSuccess) {
            showToast("info", "Removed", `${itemName} removed from cart.`);
            fetchCartState();
            
            // Refresh the cart view
            const cartResult = await app.callServerTool({
              name: "get_cart",
              arguments: {},
            });
            const cartData = parseToolResult(cartResult);
            if (cartData) {
              currentData = cartData;
              cartState = cartData as CartData;
              updateCartBadge();
              render();
            }
          } else {
            throw new Error("Failed to remove");
          }
        } catch (error) {
          target.classList.remove("loading");
          showToast("error", "Error", "Failed to remove item.");
          console.error(error);
        }
      }
    });
  });

  // Apply promo with toast feedback
  const applyPromoBtn = document.getElementById("apply-promo");
  if (applyPromoBtn) {
    applyPromoBtn.addEventListener("click", async () => {
      const input = document.getElementById("promo-input") as HTMLInputElement;
      const code = input?.value?.trim();
      
      if (code) {
        const btn = applyPromoBtn as HTMLButtonElement;
        btn.classList.add("loading");
        
        try {
          const result = await app.callServerTool({
            name: "apply_promo",
            arguments: { promo_code: code },
          });
          
          const text = extractResultText(result);
          btn.classList.remove("loading");
          
          const isSuccess = text && (text.includes("PROMO CODE APPLIED") || text.includes("🎉"));
          
          if (isSuccess) {
            showToast("success", "Promo Applied!", `Code ${code.toUpperCase()} applied!`);
            
            // Refresh cart
            const cartResult = await app.callServerTool({
              name: "get_cart",
              arguments: {},
            });
            const promoCartData = parseToolResult(cartResult);
            if (promoCartData) {
              currentData = promoCartData;
              cartState = promoCartData as CartData;
              updateCartBadge();
              render();
            }
          } else {
            showToast("error", "Invalid Code", "That promo code is not valid.");
          }
        } catch (error) {
          btn.classList.remove("loading");
          showToast("error", "Error", "Failed to apply promo code.");
          console.error(error);
        }
      } else {
        showToast("info", "Enter Code", "Please enter a promo code first.");
      }
    });
  }

  // Refresh inventory
  const refreshBtn = document.getElementById("refresh-inventory");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      try {
        const result = await app.callServerTool({
          name: "get_inventory_summary",
          arguments: {},
        });
        const invData = parseToolResult(result);
        if (invData) {
          currentData = invData;
          render();
        }
      } catch (error) {
        console.error(error);
      }
    });
  }

  // Customer type selection
  document.querySelectorAll(".customer-type-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      const customerType = target.dataset.type;
      
      // Update active state
      document.querySelectorAll(".customer-type-btn").forEach(b => b.classList.remove("active"));
      target.classList.add("active");
      
      // Update note text
      const note = document.getElementById("customer-note");
      if (note) {
        if (customerType === "new") {
          note.textContent = "New customers: Phone + Plan required for Unlimited plans";
        } else {
          note.textContent = "Existing customers: Can purchase phone or plan separately";
        }
      }
    });
  });

  // Checkout - show message to use chat with customer type info
  const checkoutBtn = document.getElementById("checkout-btn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      const activeBtn = document.querySelector(".customer-type-btn.active") as HTMLElement;
      const isNewCustomer = activeBtn?.dataset.type === "new";
      const customerTypeText = isNewCustomer ? "new" : "existing";
      
      showToast("info", "Ready to Checkout", 
        `Tell Claude: "I'm a ${customerTypeText} customer, ready to checkout" with your shipping address.`);
    });
  }

  // ===== STORE LOCATOR EVENT HANDLERS =====

  // Store list card click → select store
  document.querySelectorAll("[data-store-select]").forEach(card => {
    card.addEventListener("click", () => {
      const idx = parseInt((card as HTMLElement).dataset.storeSelect || "0", 10);
      if (idx !== selectedStoreIndex) {
        selectedStoreIndex = idx;
        render();
      }
    });
  });

  // Map pin click → select store
  document.querySelectorAll(".store-pin").forEach(pin => {
    pin.addEventListener("click", () => {
      const idx = parseInt((pin as SVGElement).dataset.storeIdx || "0", 10);
      if (idx !== selectedStoreIndex) {
        selectedStoreIndex = idx;
        render();
      }
    });
  });

  // Hours toggle
  const toggleHoursBtn = document.getElementById("toggle-hours");
  if (toggleHoursBtn) {
    toggleHoursBtn.addEventListener("click", () => {
      const container = toggleHoursBtn.closest(".store-hours-toggle") as HTMLElement;
      const grid = container?.querySelector(".store-hours-grid") as HTMLElement;
      const arrow = toggleHoursBtn.querySelector(".toggle-arrow") as HTMLElement;
      if (grid && container) {
        const expanded = container.dataset.expanded === "true";
        grid.style.display = expanded ? "none" : "block";
        container.dataset.expanded = expanded ? "false" : "true";
        if (arrow) arrow.textContent = expanded ? "▼" : "▲";
      }
    });
  }

  // ===== CROSS-WIDGET ACTION HANDLERS =====
  document.querySelectorAll("[data-cross-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = (btn as HTMLElement).dataset.crossAction;
      const storeIdx = parseInt((btn as HTMLElement).dataset.storeIdx || "0", 10);

      switch (action) {
        case "setPickup": {
          // Set selected store as pickup location — broadcast to all widgets
          const stores = (currentData as StoreSearchResult)?.stores || [];
          const store = stores[storeIdx];
          if (store) {
            selectedStore = store;
            broadcastEvent({ type: "store:setPickup", source: currentView, payload: store });
            showToast("success", "Pickup Store Set", `📦 ${store.name || "AT&T Store"} — ${store.city || ""}, ${store.state || ""}`);
            render(); // Re-render to show active state
          }
          break;
        }

        case "shopAtStore": {
          // Broadcast store selection and navigate to phones
          const stores2 = (currentData as StoreSearchResult)?.stores || [];
          const store2 = stores2[storeIdx];
          if (store2) {
            selectedStore = store2;
            broadcastEvent({ type: "store:selected", source: currentView, payload: store2 });
            broadcastEvent({ type: "navigate:phones", source: currentView });
            // Also load phones in this widget
            showToast("info", "Browsing Phones", `Near ${store2.name || "AT&T Store"}`);
            pushHistory();
            loadPhones();
          }
          break;
        }

        case "viewCart": {
          broadcastEvent({ type: "navigate:cart", source: currentView });
          pushHistory();
          loadCart();
          break;
        }

        case "clearStore": {
          selectedStore = null;
          try { sessionStorage.removeItem("att-mcp-selectedStore"); } catch { /* ignore */ }
          broadcastEvent({ type: "store:selected", source: currentView, payload: null });
          showToast("info", "Pickup Store Cleared", "Switched to delivery.");
          render();
          break;
        }
      }
    });
  });
}

// ============================================================
// MCP INTEGRATION
// ============================================================

app.ontoolresult = (result) => {
  let data = parseToolResult(result);
  
  if (data) {
    // Determine new view type
    let newView: ViewType = currentView;
    
    // Detect view type from data structure
    if (Array.isArray(data) && data.length > 0) {
      if ((data[0] as Record<string, unknown>)?.product_id) {
        newView = (data[0] as Record<string, unknown>)?.category === "Accessories" ? "accessories" : "phones";
      } else if ((data[0] as Record<string, unknown>)?.plan_id) {
        newView = (data[0] as Record<string, unknown>)?.speed_down ? "internet" : "plans";
      }
    } else if (typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if (obj.plans && Array.isArray(obj.plans)) {
        // Internet response with qualification status
        const plans = obj.plans as Record<string, unknown>[];
        if (plans[0]?.speed_down || obj.plan_type) {
          newView = "internet";
        } else if (plans[0]?.plan_id) {
          newView = "plans";
        }
      } else if (obj.item_count !== undefined) {
        newView = "cart";
        cartState = data as CartData;
        updateCartBadge();
      } else if (obj.total_products !== undefined) {
        newView = "inventory";
      } else if (obj.stores !== undefined && Array.isArray(obj.stores)) {
        newView = "stores";
        selectedStoreIndex = 0;
      }
      // Unwrap { products: [...] } envelope
      else if (Array.isArray(obj.products) && (obj.products as Record<string, unknown>[])[0]?.product_id) {
        data = obj.products;
        newView = (obj.products as Record<string, unknown>[])[0]?.category === "Accessories" ? "accessories" : "phones";
      }
    }
    
    // Save current state to history before navigating to cart
    if (newView === "cart" && currentView !== "cart" && currentData) {
      pushHistory();
    }
    
    currentData = data;
    currentPage = 0;
    currentView = newView;
    
    render();
  }
};

// Initialize app
app.connect();

// Restore shared state from other widgets
restoreSharedState();

// Fetch cart state on load (after a short delay to ensure connection)
setTimeout(() => {
  fetchCartState();
}, 500);
