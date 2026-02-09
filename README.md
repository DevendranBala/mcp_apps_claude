# AT&T Shopping MCP Server

A complete **Model Context Protocol (MCP) Apps** server that enables Claude to act as an AT&T shopping assistant with **interactive visual UI applications**.

Built using the official `@modelcontextprotocol/ext-apps` SDK.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Data Models](#data-models)
5. [Tools Reference](#tools-reference)
6. [UI Components](#ui-components)
7. [Business Logic](#business-logic)
8. [Setup & Deployment](#setup--deployment)
9. [API Reference](#api-reference)
10. [Development Guide](#development-guide)

---

## Overview

### What is This?

An MCP server that transforms Claude into a full-featured AT&T retail assistant capable of:

- Browsing phones, accessories, and plans with visual product cards
- Managing shopping carts with color/storage selection
- Qualifying addresses for internet service (Fiber vs Internet Air)
- Processing checkout with customer type validation
- Applying promotional discounts

### Key Features

| Feature | Description |
|---------|-------------|
| **Visual Product Catalogs** | Carousel UI with product cards, images, ratings |
| **Color & Storage Selection** | Interactive swatches with dynamic pricing |
| **Address Qualification** | Fiber vs Internet Air based on ZIP code |
| **Customer Type Validation** | New vs existing customer checkout rules |
| **BYOD Plans** | Bring Your Own Device plans without phone requirement |
| **Promotional Codes** | Percentage and fixed discounts |

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLAUDE (MCP HOST)                               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │  User Message   │───▶│  Tool Selection │───▶│  Response Generation    │  │
│  │  "Show phones"  │    │  get_phones     │    │  + UI Rendering         │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MCP SERVER (Node.js)                               │
│                                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │    Tools     │   │  Resources   │   │   Catalog    │   │    State     │  │
│  │              │   │              │   │              │   │              │  │
│  │ • get_phones │   │ • UI HTML    │   │ • Products   │   │ • Carts      │  │
│  │ • get_plans  │   │ • Bundled JS │   │ • Plans      │   │ • Orders     │  │
│  │ • add_to_cart│   │              │   │ • Internet   │   │ • Promos     │  │
│  │ • checkout   │   │              │   │ • Promotions │   │ • Addresses  │  │
│  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Transport Layer                               │    │
│  │   HTTP (:3001/mcp)  ←─────────────────────────→  stdio (--stdio)    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UI APP (Sandboxed iframe)                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  mcp-app.html + mcp-app.ts (bundled by Vite)                         │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   Render    │  │   Events    │  │  Tool Calls │  │    State    │  │   │
│  │  │  Products   │  │  (clicks)   │  │  (via MCP)  │  │  (local)    │  │   │
│  │  │  Carousel   │  │  Colors     │  │ add_to_cart │  │  cartState  │  │   │
│  │  │  Cards      │  │  Storage    │  │ get_cart    │  │  currentPage│  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MCP Apps Pattern

```
1. Claude calls tool (e.g., get_phones)
2. Tool has _meta.ui.resourceUri pointing to UI resource
3. Server returns data + UI resource reference
4. Claude fetches UI HTML and renders in sandboxed iframe
5. UI uses @modelcontextprotocol/ext-apps to call tools
6. UI receives tool results and updates display
```

### Communication Flow

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│  Claude  │         │  Server  │         │    UI    │
└────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                    │
     │  1. get_phones()   │                    │
     │───────────────────▶│                    │
     │                    │                    │
     │  2. JSON + UI ref  │                    │
     │◀───────────────────│                    │
     │                    │                    │
     │  3. Fetch UI HTML  │                    │
     │───────────────────▶│                    │
     │                    │                    │
     │  4. HTML resource  │                    │
     │◀───────────────────│                    │
     │                    │                    │
     │  5. Render iframe  │                    │
     │────────────────────────────────────────▶│
     │                    │                    │
     │                    │  6. ontoolresult   │
     │                    │◀───────────────────│
     │                    │                    │
     │                    │  7. UI updates     │
     │                    │───────────────────▶│
     │                    │                    │
     │         8. User clicks "Add to Cart"    │
     │◀────────────────────────────────────────│
     │                    │                    │
     │  9. add_to_cart()  │                    │
     │───────────────────▶│                    │
     │                    │                    │
```

---

## Project Structure

```
att-mcp-server/
├── main.ts                 # Entry point - HTTP & stdio transports
├── server.ts               # MCP server - tools, resources, business logic
├── mcp-app.html            # UI template - HTML structure & CSS
├── src/
│   └── mcp-app.ts          # UI logic - TypeScript for interactivity
├── data/
│   ├── catalog.xlsx        # Product database (Excel)
│   ├── carts.json          # Shopping cart state
│   └── orders.json         # Completed orders
├── dist/                   # Build output
│   ├── main.js             # Compiled server
│   └── mcp-app.html        # Bundled single-file UI
├── package.json
├── tsconfig.json           # UI TypeScript config
├── tsconfig.server.json    # Server TypeScript config
└── vite.config.ts          # Vite bundler config
```

### File Responsibilities

| File | Purpose |
|------|---------|
| `main.ts` | HTTP server setup, transport handling, request routing |
| `server.ts` | Tool definitions, business logic, catalog loading, state management |
| `mcp-app.html` | UI structure, CSS styles, toast notifications |
| `src/mcp-app.ts` | UI interactivity, event handlers, MCP communication |
| `data/catalog.xlsx` | Product/plan/promotion data (Excel format) |

---

## Data Models

### Product (Phone/Accessory)

```typescript
interface Product {
  product_id: string;      // "ATT-IP17PM"
  name: string;            // "iPhone 17 Pro Max"
  category: string;        // "Phones" | "Accessories"
  subcategory: string;     // "Flagship" | "Case" | "Charger"
  price: number;           // Base price: 1199
  monthly_price?: number;  // Optional installment price
  stock: number;           // Inventory count
  description: string;     // Product description
  brand: string;           // "Apple" | "Samsung" | "Google"
  rating: number;          // 4.8 (out of 5)
  color?: string;          // Pipe-delimited: "Black|Silver|Gold"
  storage?: string;        // Pipe-delimited: "128GB|256GB|512GB"
  storage_prices?: string; // Price increments: "128GB:0|256GB:100|512GB:200"
  ranking?: number;        // Sort order (lower = first)
}
```

### Wireless Plan

```typescript
interface Plan {
  plan_id: string;         // "PLAN-PREM"
  name: string;            // "AT&T Unlimited Premium"
  category: string;        // "Postpaid" | "BYOD" | "Family"
  price_monthly: number;   // 85
  description: string;     // Plan description
  data_limit: string;      // "Unlimited Premium" | "50GB"
  hotspot: string;         // "60GB" | "None"
  streaming: string;       // "4K UHD" | "HD 1080p" | "SD 480p"
  features: string;        // Comma-separated features
  popular?: boolean;       // Show "Popular" badge
  requires_phone?: boolean;// New customers need phone
}
```

### Internet Plan

```typescript
interface InternetPlan {
  plan_id: string;         // "INT-F500"
  name: string;            // "AT&T Fiber 500"
  category: string;        // "Fiber" | "Internet Air"
  price_monthly: number;   // 65
  speed_down: string;      // "500 Mbps"
  speed_up: string;        // "500 Mbps"
  description: string;     // Plan description
  features: string;        // Comma-separated features
  popular?: boolean;       // Show "Recommended" badge
  requires_qualification?: boolean; // Needs address check
}
```

### Cart Item

```typescript
interface CartItem {
  id: string;              // Product/plan ID
  name: string;            // Display name with options
  price: number;           // Price (with storage increment)
  quantity: number;        // Quantity
  type: "product" | "plan" | "internet";
  color?: string;          // Selected color
  storage?: string;        // Selected storage
}
```

### Cart State

```typescript
interface Cart {
  items: CartItem[];
  promo_code: string | null;
}

// Calculated cart summary
interface CartSummary {
  items: CartItem[];
  item_count: number;
  subtotal: number;
  discount: number;
  promo_code: string | null;
  tax: number;           // 8.25%
  shipping: number;      // Free over $35
  total: number;
}
```

### Address Qualification

```typescript
interface QualificationState {
  address: string;
  zip: string;
  fiber_available: boolean;
  qualified_at: string;    // ISO timestamp
}

// Qualification rules:
// - ZIP prefixes 90-95, 10-12, 20-22 → Fiber available
// - All other ZIPs → Internet Air only
```

---

## Tools Reference

### Interactive UI Tools

These tools return JSON data AND link to a visual UI resource.

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_phones` | Browse phone catalog with carousel UI | `brand?`, `max_price?`, `foldable?`, `limit?` |
| `get_accessories` | Browse accessories catalog | `brand?`, `max_price?`, `limit?` |
| `get_wireless_plans` | Compare wireless plans | `category?`, `max_price?` |
| `get_internet_plans` | Browse internet plans (requires qualification) | `min_speed?`, `user_id?` |
| `get_cart` | View shopping cart with checkout UI | `user_id?` |
| `get_inventory_summary` | Admin inventory dashboard | - |

### Action Tools

These tools perform operations and return text responses.

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_products` | Search catalog by keyword | `query?`, `category?`, `brand?`, `min_price?`, `max_price?`, `limit?` |
| `add_to_cart` | Add item to cart | `product_id`, `product_type?`, `quantity?`, `color?`, `storage?`, `user_id?` |
| `remove_from_cart` | Remove item from cart | `product_id`, `user_id?` |
| `apply_promo` | Apply promotional code | `promo_code`, `user_id?` |
| `clear_cart` | Empty the cart | `user_id?` |
| `check_address` | Qualify address for internet | `address`, `zip`, `city?`, `state?`, `user_id?` |
| `checkout` | Complete purchase | `shipping_address`, `is_new_customer`, `user_id?` |
| `get_promotions` | List active promo codes | - |

### Tool Registration Pattern

```typescript
// Interactive tool with UI
registerAppTool(
  server,
  "get_phones",
  {
    title: "Phone Catalog",
    description: "Browse AT&T phones with visual interface",
    inputSchema: {
      brand: z.string().optional(),
      max_price: z.number().optional(),
    },
    _meta: { ui: { resourceUri: "app://att-shopping/phone-browser" } },
  },
  async (args) => {
    const products = await getProducts(args);
    return { content: [{ type: "text", text: JSON.stringify(products) }] };
  }
);

// Standard tool without UI
server.tool(
  "add_to_cart",
  "Add item to cart",
  {
    product_id: z.string(),
    color: z.string().optional(),
    storage: z.string().optional(),
  },
  async (args) => {
    const result = await addToCart(args);
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);
```

---

## UI Components

### Component Hierarchy

```
App Container (#app)
├── Header
│   ├── Title & Count
│   └── Page Navigation Info
├── Carousel Container
│   ├── Prev Button (‹)
│   ├── Carousel Wrapper
│   │   └── Carousel Track (CSS transform)
│   │       ├── Product Card 1
│   │       ├── Product Card 2
│   │       └── ...
│   └── Next Button (›)
├── Page Dots
│   ├── Dot 1
│   ├── Dot 2
│   └── ...
├── Cart Badge (floating)
│   └── Item Count
└── Toast Container (notifications)
```

### Product Card Structure

```html
<div class="product-card" 
     data-product-id="ATT-IP17PM"
     data-base-price="1199"
     data-selected-color="Cosmic Orange"
     data-selected-storage="256GB">
  
  <!-- Product Image -->
  <img src="..." class="product-image" />
  
  <!-- Category Badge -->
  <span class="product-badge badge-phone">Flagship</span>
  
  <!-- Product Info -->
  <div class="product-brand">Apple</div>
  <div class="product-name">iPhone 17 Pro Max</div>
  
  <!-- Color Selector -->
  <div class="color-selector">
    <div class="color-name">Cosmic Orange</div>
    <div class="color-swatches">
      <button class="color-swatch active" data-color="Cosmic Orange" />
      <button class="color-swatch" data-color="Space Black" />
    </div>
  </div>
  
  <!-- Storage Selector -->
  <div class="storage-selector">
    <div class="storage-label">Storage</div>
    <div class="storage-options">
      <button class="storage-option active" data-storage="256GB">256GB</button>
      <button class="storage-option" data-storage="512GB">512GB +$200</button>
    </div>
  </div>
  
  <!-- Pricing -->
  <div class="product-price">$1,199</div>
  <div class="product-monthly">$33.31/mo × 36</div>
  
  <!-- Rating & Stock -->
  <div class="product-rating">⭐⭐⭐⭐⭐ 4.9</div>
  <span class="stock-badge stock-high">✓ In Stock</span>
  
  <!-- Action Button -->
  <button class="btn btn-primary add-to-cart" 
          data-id="ATT-IP17PM" 
          data-type="product">
    🛒 Add to Cart
  </button>
</div>
```

### Carousel Navigation

```typescript
const ITEMS_PER_PAGE = 3;
let currentPage = 0;

function setupCarousel(totalItems: number): void {
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const track = document.getElementById("carousel-track");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  
  function updateCarousel(): void {
    // Move track using CSS transform
    const offset = currentPage * ITEMS_PER_PAGE * CARD_WIDTH;
    track.style.transform = `translateX(-${offset}px)`;
    
    // Update button states
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage >= totalPages - 1;
    
    // Update page dots
    updatePageDots();
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
}
```

### Color Swatch System

```typescript
// Color name to hex mapping
const COLOR_MAP: Record<string, string> = {
  "Cosmic Orange": "#FF6B35",
  "Space Black": "#1d1d1f",
  "Natural Titanium": "#9a9a9f",
  "Ultramarine": "#2851A3",
  "Titanium Black": "#3d3d3d",
  // ... 50+ colors
};

function getColorHex(colorName: string): string {
  return COLOR_MAP[colorName] || "#cccccc";
}

function setupColorSwatches(): void {
  document.querySelectorAll(".color-swatch").forEach(swatch => {
    swatch.addEventListener("click", (e) => {
      const card = target.closest(".product-card");
      const colorName = target.dataset.color;
      
      // Update active state
      card.querySelectorAll(".color-swatch").forEach(s => 
        s.classList.remove("active"));
      target.classList.add("active");
      
      // Update color name display
      card.querySelector(".color-name").textContent = colorName;
      
      // Store selection for add-to-cart
      card.dataset.selectedColor = colorName;
    });
  });
}
```

### Dynamic Storage Pricing

```typescript
function setupStorageOptions(): void {
  document.querySelectorAll(".storage-option").forEach(option => {
    option.addEventListener("click", (e) => {
      const button = e.currentTarget as HTMLElement;
      const card = button.closest(".product-card") as HTMLElement;
      const storage = button.dataset.storage;
      const priceIncrement = parseInt(button.dataset.priceIncrement || "0");
      
      // Update active state
      card.querySelectorAll(".storage-option").forEach(s => 
        s.classList.remove("active"));
      button.classList.add("active");
      
      // Calculate new price
      const basePrice = parseFloat(card.dataset.basePrice);
      const newPrice = basePrice + priceIncrement;
      const newMonthly = newPrice / 36;
      
      // Update price display
      card.querySelector(".product-price").textContent = 
        `$${newPrice.toLocaleString()}`;
      card.querySelector(".product-monthly").textContent = 
        `$${newMonthly.toFixed(2)}/mo × 36`;
      
      // Store selection
      card.dataset.selectedStorage = storage;
    });
  });
}
```

---

## Business Logic

### Address Qualification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Address Qualification                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  User asks about internet service                                │
│  "I want home internet at 123 Main St, 90210"                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Claude calls check_address tool                                 │
│  { address: "123 Main St", zip: "90210" }                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server checks ZIP prefix                                        │
│  90xxx = West Coast = Fiber Available ✓                         │
│  (Other ZIPs = Internet Air only)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Store qualification in cache                                    │
│  qualificationCache["default"] = {                              │
│    address: "123 Main St",                                      │
│    zip: "90210",                                                │
│    fiber_available: true                                        │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Claude calls get_internet_plans                                 │
│  Server returns only Fiber plans (user is qualified)            │
│  UI shows Fiber product cards                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Fiber Qualification Rules

```typescript
const FIBER_ZIPS = ['90', '91', '92', '93', '94', '95', // West Coast
                    '10', '11', '12',                    // NY Metro
                    '20', '21', '22'];                   // DC Area

function isFiberAvailable(zip: string): boolean {
  const prefix = zip.substring(0, 2);
  return FIBER_ZIPS.includes(prefix);
}
```

### Checkout Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Checkout Validation                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Check customer type                                          │
│     is_new_customer: true/false                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│    NEW CUSTOMER         │     │   EXISTING CUSTOMER     │
│                         │     │                         │
│  Postpaid plan?         │     │   No restrictions       │
│    → Must have phone    │     │   Can buy phone only    │
│                         │     │   Can buy plan only     │
│  Phone purchase?        │     │                         │
│    → Must have plan     │     │                         │
│    (Postpaid or BYOD)   │     │                         │
│                         │     │                         │
│  BYOD plan?             │     │                         │
│    → No phone required  │     │                         │
└─────────────────────────┘     └─────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Validate shipping address                                    │
│     Required: name, street, city, state, zip                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Create order                                                 │
│     - Generate order ID                                          │
│     - Calculate totals                                           │
│     - Clear cart                                                 │
│     - Save to orders.json                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Validation Code

```typescript
async function checkout(args: {
  shipping_address: ShippingAddress;
  is_new_customer: boolean;
  user_id?: string;
}) {
  const cart = await getCart(args.user_id);
  const { plans } = await loadCatalog();
  
  const hasPhone = cart.items.some(i => i.type === "product");
  const hasPostpaidPlan = cart.items.some(i => {
    if (i.type === "plan") {
      const plan = plans.find(p => p.plan_id === i.id);
      return plan?.category === "Postpaid";
    }
    return false;
  });
  const hasBYODPlan = cart.items.some(i => {
    if (i.type === "plan") {
      const plan = plans.find(p => p.plan_id === i.id);
      return plan?.category === "BYOD";
    }
    return false;
  });

  // New customer validation
  if (args.is_new_customer) {
    if (hasPostpaidPlan && !hasPhone) {
      return { 
        success: false, 
        message: "New customers must purchase a phone with Unlimited plans",
        validation_error: "PHONE_REQUIRED"
      };
    }
    if (hasPhone && !hasPostpaidPlan && !hasBYODPlan) {
      return { 
        success: false, 
        message: "New customers must select a wireless plan",
        validation_error: "PLAN_REQUIRED"
      };
    }
  }
  
  // Proceed with order...
}
```

### Pricing Calculations

```typescript
// Storage-based pricing
function calculatePrice(basePrice: number, storage: string, storagePrices: string): number {
  if (!storage || !storagePrices) return basePrice;
  
  const priceMap = storagePrices.split('|').reduce((acc, item) => {
    const [size, increment] = item.split(':');
    acc[size.trim()] = parseInt(increment) || 0;
    return acc;
  }, {} as Record<string, number>);
  
  return basePrice + (priceMap[storage] || 0);
}

// Cart totals
function calculateCartTotals(items: CartItem[], promoCode: string | null) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  
  let discount = 0;
  if (promoCode) {
    const promo = findPromo(promoCode);
    if (promo && subtotal >= promo.min_order) {
      discount = promo.type === "percent" 
        ? subtotal * (promo.value / 100)
        : promo.value;
    }
  }
  
  const tax = (subtotal - discount) * 0.0825;  // 8.25% tax
  const shipping = subtotal >= 35 ? 0 : 7.99;  // Free over $35
  
  return {
    subtotal: round(subtotal),
    discount: round(discount),
    tax: round(tax),
    shipping: round(shipping),
    total: round(subtotal - discount + tax + shipping)
  };
}
```

---

## Setup & Deployment

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Clone or extract project
cd att-mcp-server

# Install dependencies
npm install

# Build (compiles TypeScript + bundles UI)
npm run build

# Start server
npm run serve
```

### Deployment Options

#### Option 1: ngrok (Quick Testing)

```bash
# Terminal 1: Start server
npm run serve

# Terminal 2: Create tunnel
ngrok http 3001

# Use the ngrok URL in Claude connector settings
```

#### Option 2: Cloudflare Tunnel (Production)

```bash
# Start server
npm run serve

# Create tunnel
npx cloudflared tunnel --url http://localhost:3001

# Use the cloudflared URL in Claude connector settings
```

#### Option 3: Claude Desktop (Local)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "att-shopping": {
      "command": "node",
      "args": ["/path/to/att-mcp-server/dist/main.js", "--stdio"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | HTTP server port |

---

## API Reference

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info page |
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/health` | GET | Health check |

### MCP JSON-RPC

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_phones",
    "arguments": { "brand": "Apple", "limit": 10 }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "[{\"product_id\":\"ATT-IP17PM\",...}]" }
    ]
  }
}
```

### Resource URIs

| URI | Description |
|-----|-------------|
| `app://att-shopping/phone-browser` | Phone catalog UI |
| `app://att-shopping/accessory-browser` | Accessory catalog UI |
| `app://att-shopping/plan-browser` | Wireless plans UI |
| `app://att-shopping/internet-browser` | Internet plans UI |
| `app://att-shopping/cart` | Shopping cart UI |
| `app://att-shopping/inventory-dashboard` | Inventory admin UI |

---

## Development Guide

### Build Commands

```bash
# Full build (TypeScript + UI bundle)
npm run build

# Development mode (watch + auto-restart)
npm start

# Type checking only
npx tsc --noEmit

# Server compilation only
npx tsc -p tsconfig.server.json

# UI bundle only
npx vite build
```

### Adding a New Product

1. Edit `data/catalog.xlsx` → Products sheet
2. Add row with all required fields
3. Restart server (catalog is cached)

### Adding a New Tool

```typescript
// In server.ts

// 1. Define business logic function
async function myNewFunction(args: MyArgs): Promise<MyResult> {
  // Implementation
}

// 2. Register tool
server.tool(
  "my_new_tool",
  "Description for Claude",
  {
    param1: z.string().describe("Parameter description"),
    param2: z.number().optional(),
  },
  async (args) => {
    const result = await myNewFunction(args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

### Adding a New UI View

1. Add render function in `src/mcp-app.ts`:
```typescript
function renderMyView(data: MyData): string {
  return `
    <div class="header">...</div>
    <div class="content">...</div>
  `;
}
```

2. Add view type:
```typescript
type ViewType = "phones" | "accessories" | ... | "myview";
```

3. Update render switch:
```typescript
switch (currentView) {
  case "myview": html = renderMyView(currentData as MyData); break;
}
```

4. Add detection in `ontoolresult`:
```typescript
if (data.myViewIdentifier) {
  currentView = "myview";
}
```

### Testing

```bash
# Manual testing with curl
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Test specific tool
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_phones","arguments":{}}}'
```

---

## Product Catalog Summary

### Phones

| Brand | Models | Price Range |
|-------|--------|-------------|
| Apple | iPhone 17 Pro Max, 17 Pro, 17 Air, 17, 16 series, 15 series, 14 | $699 - $1,599 |
| Samsung | Galaxy S25 Ultra, S25+, S25, S24 series, Z Fold6, Z Flip6, A54 | $449 - $1,899 |
| Google | Pixel 9 Pro XL, 9 Pro, 9, 8 Pro, 8 | $699 - $1,099 |

### Wireless Plans

| Category | Plans | Price Range |
|----------|-------|-------------|
| Postpaid | Premium, Extra, Starter | $65 - $85/mo |
| BYOD | 5GB, 15GB, Unlimited, Unlimited Plus | $30 - $50/mo |
| Family | 4 Lines | $160/mo |

### Internet Plans

| Category | Plans | Price Range |
|----------|-------|-------------|
| Fiber | 300, 500, 1 GIG, 2 GIG | $55 - $110/mo |
| Internet Air | Standard, Plus | $55 - $75/mo |

### Promo Codes

| Code | Discount | Minimum |
|------|----------|---------|
| ATT20 | 20% off | $100 |
| NEWLINE50 | $50 off | $50 |
| FREESHIP | Free shipping | $35 |

---

## License

MIT License - See LICENSE file for details.

---

Built with ❤️ using the [Model Context Protocol](https://modelcontextprotocol.io) and [@modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps)
