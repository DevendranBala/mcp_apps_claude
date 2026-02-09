/**
 * AT&T Shopping MCP Server
 * 
 * A complete MCP Apps implementation for AT&T retail shopping with interactive UIs.
 * Built following the @modelcontextprotocol/ext-apps pattern.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as McpServerClass } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { z } from "zod";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const DATA_DIR = path.join(import.meta.dirname, "data");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.xlsx");
const CARTS_PATH = path.join(DATA_DIR, "carts.json");
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");

// AT&T Public APIs
const ATT_TRADEIN_API = "https://www.att.com/sharedoffer/prod/tradein/unified/config.json";
// AT&T IMEI API (requires Akamai browser session — not callable server-side)
// Reference: POST https://www.att.com/msapi/sales/websalesdeviceorchms/v1/devices/validateimei

// IMEI Validation API Types
interface ImeiDeviceInfo {
  manufacturer?: string;
  model?: string;
  modelName?: string;
  deviceType?: string;
  brand?: string;
  operatingSystem?: string;
  capacity?: string;
  color?: string;
  networkType?: string;
  simType?: string;
  esimCapable?: boolean;
}

// ImeiValidationResponse — kept as reference for AT&T IMEI API response shape
// (API requires Akamai browser session, not callable server-side)
// interface ImeiValidationResponse {
//   valid?: boolean; eligible?: boolean; deviceInfo?: ImeiDeviceInfo;
//   compatibilityStatus?: string; blacklistStatus?: string; lockStatus?: string;
// }

// Trade-In API Response Types
interface TradeInDevice {
  name: string;
  image: string;
  modelCode: string;
  modelPrice: number;
  capacity: string;
  promotions: string[];
}

interface TradeInModel {
  name: string;
  productFamily: TradeInDevice[];
}

interface TradeInMake {
  name: string;
  models: TradeInModel[];
}

interface TradeInCategory {
  category: string;
  questions: Array<{
    questionCode: string;
    text: string;
    helpText: string;
    sortOrder: number;
    validAnswers: Array<{
      answerText: string;
      skuCode: string;
      questionCode: string;
    }>;
  }>;
  makes: TradeInMake[];
}

interface TradeInApiResponse {
  date: string;
  devices: TradeInCategory[];
}

// Cache for trade-in data (refreshed every 15 minutes)
let tradeInCache: TradeInApiResponse | null = null;
let tradeInCacheTime = 0;
const TRADEIN_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ============================================================
// DATA LAYER
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
  color?: string;
  colors?: string[];  // Parsed colors array
  storage?: string;
  storage_prices?: string;  // Format: "128GB:0|256GB:100|512GB:200"
  features?: string;
  ranking?: number;
  image?: string;
}

interface Plan {
  plan_id: string;
  name: string;
  category: string;  // "Postpaid", "BYOD", "Family"
  price_monthly: number;
  description: string;
  data_limit: string;
  hotspot: string;
  streaming: string;
  features: string;
  lines?: number;
  popular?: boolean;
  requires_phone?: boolean;  // True for Postpaid plans (new customers)
}

interface InternetPlan {
  plan_id: string;
  name: string;
  category: string;
  price_monthly: number;
  speed_down: string;
  speed_up: string;
  description: string;
  features: string;
  popular?: boolean;
  requires_qualification?: boolean;
}

// Address qualification state (in-memory for demo)
interface QualificationState {
  address?: string;
  zip?: string;
  fiber_available: boolean;
  qualified_at?: string;
}

const qualificationCache: Record<string, QualificationState> = {};

interface Promotion {
  code: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  min_order: number;
  description: string;
  active: boolean;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  type: "product" | "plan" | "internet";
  color?: string;
  storage?: string;
}

interface Cart {
  items: CartItem[];
  promo_code: string | null;
}

interface Order {
  order_id: string;
  user_id: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
  shipping_address: ShippingAddress;
  status: string;
  created_at: string;
}

interface ShippingAddress {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface CatalogData {
  products: Product[];
  plans: Plan[];
  internet: InternetPlan[];
  promotions: Promotion[];
}

let catalog: CatalogData | null = null;

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
  "ATT-A54": "https://i.imgur.com/8KsQPjq.png",
  "ATT-P8P": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P8": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P9P": "https://i.imgur.com/9D3zKjL.png",
  "ATT-P9": "https://i.imgur.com/9D3zKjL.png",
  "ATT-APP2": "https://i.imgur.com/YqKsV3r.png",
  "ATT-APP3": "https://i.imgur.com/YqKsV3r.png",
  "ATT-GBP2": "https://i.imgur.com/L3kR5Wp.png",
  "ATT-MAGSAFE": "https://i.imgur.com/mXvZf7P.png",
};

function getProductImage(productId: string): string {
  return PRODUCT_IMAGES[productId] || "https://i.imgur.com/JgYf2vB.png";
}

async function loadCatalog(): Promise<CatalogData> {
  if (catalog) return catalog;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CATALOG_PATH);

  function parseSheet<T>(sheetName: string): T[] {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) return [];

    const rows: Record<string, unknown>[] = [];
    const headers: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell) => {
          headers.push(String(cell.value || ""));
        });
      } else {
        const rowData: Record<string, unknown> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header] = cell.value;
          }
        });
        if (Object.keys(rowData).length > 0) {
          rows.push(rowData);
        }
      }
    });

    return rows as T[];
  }

  // Parse products and process colors
  const products = parseSheet<Product>("Products").map(p => ({
    ...p,
    colors: p.color ? String(p.color).split('|').map(c => c.trim()) : [],
    image: getProductImage(p.product_id),
    ranking: p.ranking || 99,
  }));

  // Sort products by ranking (lower = first)
  products.sort((a, b) => (a.ranking || 99) - (b.ranking || 99));

  catalog = {
    products,
    plans: parseSheet<Plan>("Plans"),
    internet: parseSheet<InternetPlan>("Internet"),
    promotions: parseSheet<Promotion>("Promotions"),
  };

  return catalog;
}

async function loadJson<T>(filePath: string): Promise<T> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {} as T;
  }
}

async function saveJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============================================================
// TRADE-IN API INTEGRATION
// ============================================================

async function fetchTradeInData(): Promise<TradeInApiResponse | null> {
  const now = Date.now();
  
  // Return cached data if still valid
  if (tradeInCache && (now - tradeInCacheTime) < TRADEIN_CACHE_TTL) {
    return tradeInCache;
  }
  
  try {
    const response = await fetch(ATT_TRADEIN_API);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as TradeInApiResponse;
    tradeInCache = data;
    tradeInCacheTime = now;
    return data;
  } catch (error) {
    console.error("Failed to fetch trade-in data:", error);
    return tradeInCache; // Return stale cache if available
  }
}

async function getTradeInBrands(): Promise<string[]> {
  const data = await fetchTradeInData();
  if (!data) return [];
  
  const phoneCategory = data.devices.find(d => d.category === "phone");
  if (!phoneCategory) return [];
  
  return phoneCategory.makes.map(m => m.name);
}

async function getTradeInModels(brand: string): Promise<string[]> {
  const data = await fetchTradeInData();
  if (!data) return [];
  
  const phoneCategory = data.devices.find(d => d.category === "phone");
  if (!phoneCategory) return [];
  
  const make = phoneCategory.makes.find(m => m.name.toLowerCase() === brand.toLowerCase());
  if (!make) return [];
  
  return make.models.map(m => m.name);
}

async function getTradeInValue(args: {
  brand: string;
  model: string;
  capacity?: string;
  good_condition?: boolean;
}): Promise<{
  success: boolean;
  device?: {
    brand: string;
    model: string;
    capacity: string;
    image: string;
    base_value: number;
    condition_value: number;
    available_capacities: Array<{ capacity: string; value: number }>;
  };
  message: string;
}> {
  const data = await fetchTradeInData();
  if (!data) {
    return { success: false, message: "Unable to fetch trade-in data. Please try again." };
  }
  
  const phoneCategory = data.devices.find(d => d.category === "phone");
  if (!phoneCategory) {
    return { success: false, message: "Trade-in data not available." };
  }
  
  const make = phoneCategory.makes.find(m => 
    m.name.toLowerCase() === args.brand.toLowerCase()
  );
  if (!make) {
    return { 
      success: false, 
      message: `Brand "${args.brand}" not found. Available brands: ${phoneCategory.makes.map(m => m.name).join(", ")}`
    };
  }
  
  // Find model (fuzzy match)
  const model = make.models.find(m => 
    m.name.toLowerCase().includes(args.model.toLowerCase()) ||
    args.model.toLowerCase().includes(m.name.toLowerCase())
  );
  if (!model) {
    return { 
      success: false, 
      message: `Model "${args.model}" not found for ${args.brand}. Available models: ${make.models.slice(0, 10).map(m => m.name).join(", ")}...`
    };
  }
  
  // Get all capacities for this model
  const capacities = model.productFamily.map(pf => ({
    capacity: pf.capacity,
    value: pf.modelPrice
  }));
  
  // Find specific capacity or default to first
  let selectedDevice = model.productFamily[0];
  if (args.capacity) {
    const match = model.productFamily.find(pf => 
      pf.capacity.toLowerCase() === args.capacity!.toLowerCase()
    );
    if (match) selectedDevice = match;
  }
  
  // Apply condition modifier (bad condition = 50% of value)
  const conditionMultiplier = args.good_condition !== false ? 1 : 0.5;
  const conditionValue = Math.round(selectedDevice.modelPrice * conditionMultiplier);
  
  return {
    success: true,
    device: {
      brand: args.brand,
      model: model.name,
      capacity: selectedDevice.capacity,
      image: selectedDevice.image,
      base_value: selectedDevice.modelPrice,
      condition_value: conditionValue,
      available_capacities: capacities
    },
    message: `Trade-in value for ${model.name} (${selectedDevice.capacity}): $${conditionValue}`
  };
}

async function searchTradeInDevices(query: string): Promise<Array<{
  brand: string;
  model: string;
  capacities: Array<{ capacity: string; value: number }>;
  image: string;
}>> {
  const data = await fetchTradeInData();
  if (!data) return [];
  
  const phoneCategory = data.devices.find(d => d.category === "phone");
  if (!phoneCategory) return [];
  
  const results: Array<{
    brand: string;
    model: string;
    capacities: Array<{ capacity: string; value: number }>;
    image: string;
  }> = [];
  
  const q = query.toLowerCase();
  
  for (const make of phoneCategory.makes) {
    for (const model of make.models) {
      if (model.name.toLowerCase().includes(q) || 
          make.name.toLowerCase().includes(q)) {
        results.push({
          brand: make.name,
          model: model.name,
          capacities: model.productFamily.map(pf => ({
            capacity: pf.capacity,
            value: pf.modelPrice
          })),
          image: model.productFamily[0]?.image || ""
        });
      }
    }
  }
  
  return results.slice(0, 20); // Limit to 20 results
}

// ============================================================
// AT&T STORE LOCATOR API
// ============================================================

// AT&T OneMap Store Locator API
// Endpoint: GET https://www.att.com/msapi/onemap/v2/locator/search/query
// Parameters:
//   poi_types: Point of interest type (pos = point of sale)
//   max: Maximum number of results
//   radius: Search radius in miles
//   vtypes: Store type codes (122 = company-owned retail, etc.)
//   channels: Sales channel (2 = retail)
//   postal: ZIP code to search around
//   city/state: Alternative to postal
//   lat/lng: Alternative to postal (coordinates)
//   select: Fields to return in response

const ATT_STORE_API = "https://www.att.com/msapi/onemap/v2/locator/search/query";

// Store type codes (vtypes) — each value must be appended separately
// @ts-ignore temporarily unused during diagnostic
const ATT_STORE_VTYPES = {
  COMPANY_STORE: ["122"],              // AT&T company-owned store
  AUTHORIZED_RETAILER: ["4"],          // Authorized retailer
  ALL_RETAIL: ["122", "4"],            // Both types
};

// Channel codes
// @ts-ignore temporarily unused during diagnostic
const ATT_STORE_CHANNELS = {
  RETAIL: ["2"],                       // Retail stores
  ALL: ["1", "2", "3"],                // All channels
};

/*
// Fields available in the OneMap API (kept for reference, not sent to avoid over-filtering)
const ATT_STORE_SELECT_FIELDS = [
  "id", "name", "mystore_name", "channel", "vtype",
  "inv_id", "opus_id", "services",
  "address1", "address2", "city", "state", "postalcode",
  "phone", "latitude", "longitude", "distance",
  "sundayopen", "sundayclose",
  "mondayopen", "mondayclose",
  "tuesdayopen", "tuesdayclose",
  "wednesdayopen", "wednesdayclose",
  "thursdayopen", "thursdayclose",
  "fridayopen", "fridayclose",
  "saturdayopen", "saturdayclose",
];
*/

interface AttStoreLocation {
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
  [key: string]: unknown;
}

// API response is dynamically parsed — see searchAttStores

// Search for AT&T stores using the OneMap API

async function searchAttStores(params: {
  postal?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
  max?: number;
  radius?: number;
  storeType?: "company" | "authorized" | "all";
}): Promise<{
  success: boolean;
  stores: AttStoreLocation[];
  totalCount: number;
  message: string;
  debug?: { status?: number; resp_code?: number; searchMethod?: string; url?: string; keys?: string[]; keyInfo?: Record<string, string>; storeFields?: string[]; storeFieldSample?: Record<string, string>; rawBody?: string };
}> {
  const queryParams = new URLSearchParams();
  queryParams.set("max", String(params.max || 5));
  queryParams.set("radius", String(params.radius || 50));

  // NOTE: Do NOT use the `select` parameter — it's broken.
  // The API acknowledges `select` in query echo but ignores it,
  // returning only id/service/tag/alert instead of full data.
  // Without `select`, the API returns ALL fields by default 
  // including address, hours, lat/lon, phone, etc.

  // Location params — API DISCARDs lat/lon, so only postal and q work
  if (params.postal) {
    queryParams.set("postal", params.postal);
  } else if (params.city && params.state) {
    queryParams.set("q", `${params.city}, ${params.state}`);
  } else if (params.lat !== undefined && params.lng !== undefined) {
    // lat/lon get DISCARDED by this API but try anyway
    queryParams.set("postal", "00000"); // placeholder
  } else {
    return { success: false, stores: [], totalCount: 0, message: "Location required: provide postal code or city+state." };
  }

  const url = `${ATT_STORE_API}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
        "Origin": "https://www.att.com",
        "Referer": "https://www.att.com/stores/",
      },
    });

    if (!response.ok) {
      let errorBody = "";
      try { errorBody = await response.text(); } catch { /* ignore */ }
      return {
        success: false,
        stores: [],
        totalCount: 0,
        message: `AT&T Store API returned HTTP ${response.status}`,
        debug: {
          status: response.status,
          searchMethod: params.postal ? `postal: ${params.postal}` : params.city ? `city: ${params.city}, ${params.state}` : `lat/lon`,
          url: url.replace(ATT_STORE_API, "").slice(0, 300),
          rawBody: errorBody.slice(0, 1000),
        },
      };
    }

    let data: Record<string, unknown>;
    let rawBody = "";
    try {
      rawBody = await response.text();
      data = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return {
        success: false,
        stores: [],
        totalCount: 0,
        message: "AT&T Store API returned invalid response",
        debug: { status: response.status, rawBody: rawBody.slice(0, 2000) },
      };
    }

    // The AT&T OneMap API nests store data — find the array
    // Known possible keys: locations, data, results, features, pois, list
    let stores: AttStoreLocation[] = [];
    const possibleArrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
    const possibleObjectKeys = Object.keys(data).filter(k => data[k] && typeof data[k] === "object" && !Array.isArray(data[k]));

    // Check top-level arrays first
    for (const key of possibleArrayKeys) {
      const arr = data[key] as unknown[];
      if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null) {
        const first = arr[0] as Record<string, unknown>;
        // Does this look like a store? Check for address/lat/name fields
        if (first.latitude || first.lat || first.address1 || first.name || first.id) {
          stores = arr as AttStoreLocation[];
          break;
        }
      }
    }

    // If no top-level array found, check nested objects
    if (stores.length === 0) {
      for (const key of possibleObjectKeys) {
        const obj = data[key] as Record<string, unknown>;
        const nestedArrayKeys = Object.keys(obj).filter(k => Array.isArray(obj[k]));
        for (const nk of nestedArrayKeys) {
          const arr = obj[nk] as unknown[];
          if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null) {
            const first = arr[0] as Record<string, unknown>;
            if (first.latitude || first.lat || first.address1 || first.name || first.id) {
              stores = arr as AttStoreLocation[];
              break;
            }
          }
        }
        if (stores.length > 0) break;
      }
    }

    const totalCount = (data.allcount as number) || (data.count as number) || (data.totalCount as number) || stores.length;
    const respCode = data.resp_code as number | undefined;

    // Build debug with key types for diagnosis
    const keyInfo: Record<string, string> = {};
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v)) keyInfo[k] = `array[${v.length}]`;
      else if (v && typeof v === "object") keyInfo[k] = `object{${Object.keys(v as Record<string, unknown>).slice(0, 5).join(",")}}`;
      else keyInfo[k] = `${typeof v}:${String(v).slice(0, 50)}`;
    }

    // Log first store's actual keys for field discovery
    let storeFields: string[] = [];
    let storeFieldSample: Record<string, string> = {};
    if (stores.length > 0) {
      const sample = stores[0] as Record<string, unknown>;
      storeFields = Object.keys(sample);
      // Capture hour-related and address fields for debugging
      for (const k of storeFields) {
        const v = sample[k];
        if (v !== undefined && v !== null && v !== "") {
          const kl = k.toLowerCase();
          if (kl.includes("hour") || kl.includes("open") || kl.includes("close") || kl.includes("time") || 
              kl.includes("day") || kl.includes("address") || kl.includes("city") || kl.includes("state") || 
              kl.includes("zip") || kl.includes("postal") || kl.includes("name") || kl.includes("phone") ||
              kl.includes("lat") || kl.includes("lon") || kl.includes("lng") || kl.includes("distance") ||
              kl.includes("service") || kl.includes("vtype") || kl.includes("type")) {
            storeFieldSample[k] = String(v).slice(0, 100);
          }
        }
      }
    }

    return {
      success: true,
      stores,
      totalCount,
      message: stores.length > 0
        ? `Found ${stores.length} AT&T store${stores.length !== 1 ? "s" : ""}`
        : `No AT&T stores found (resp_code: ${respCode}, count: ${data.count})`,
      debug: {
        status: response.status,
        resp_code: respCode,
        searchMethod: params.postal ? `postal: ${params.postal}` : params.city ? `city: ${params.city}, ${params.state}` : `lat/lon`,
        url: url.replace(ATT_STORE_API, "").slice(0, 500),
        keyInfo,
        storeFields,
        storeFieldSample,
        rawBody: rawBody.slice(0, 3000),
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { success: false, stores: [], totalCount: 0, message: `AT&T Store API error: ${errMsg}`, debug: { rawBody: errMsg } };
  }
}

// ============================================================
// IMEI VALIDATION API
// ============================================================

// Hyla Mobile API (AT&T's trade-in verification partner)
// AT&T's trade-in flow: tradein.att.com → gateway.hyla.hylamobile.com
// IMEI verification endpoint: GET /19x6welpmu?modelCode=X&imeiEsn=Y&mtn=Z&response=<token>
// Mobile number endpoint: GET /4rxriawa6n?mobileNumber=X
const HYLA_API_BASE = "https://gateway.hyla.hylamobile.com";
const HYLA_IMEI_ENDPOINT = "/19x6welpmu";
// Mobile number endpoint (requires session): /4rxriawa6n?mobileNumber=X
const HYLA_PROGRAM = "consumer_att";

interface HylaResponse {
  [key: string]: unknown;
}

// ── IMEI Validation (Local) ──────────────────────────────────────────
// IMEI validation is done locally using:
//   1. Length check (exactly 15 digits)
//   2. Luhn checksum algorithm (check digit verification)
// This is the same validation method used by carriers and GSMA.
// The AT&T IMEI API and Hyla gateway both require active browser sessions
// and cannot be called server-side reliably.

function validateImeiFormat(imei: string): {
  valid: boolean;
  cleanImei: string;
  luhnValid: boolean;
  message: string;
} {
  const cleanImei = imei.replace(/[\s\-().]/g, "");

  // Check length
  if (cleanImei.length !== 15) {
    return {
      valid: false,
      cleanImei,
      luhnValid: false,
      message: `IMEI must be exactly 15 digits. Received ${cleanImei.length} digit${cleanImei.length !== 1 ? "s" : ""}: "${cleanImei}"`,
    };
  }

  // Check all digits
  if (!/^\d{15}$/.test(cleanImei)) {
    return {
      valid: false,
      cleanImei,
      luhnValid: false,
      message: `IMEI must contain only digits. Received: "${cleanImei}"`,
    };
  }

  // Luhn checksum validation
  const luhnValid = luhnCheck(cleanImei);

  if (!luhnValid) {
    return {
      valid: false,
      cleanImei,
      luhnValid: false,
      message: `IMEI failed Luhn checksum verification. This is likely not a valid IMEI number.`,
    };
  }

  return {
    valid: true,
    cleanImei,
    luhnValid: true,
    message: `IMEI is valid (15 digits, Luhn checksum passed).`,
  };
}

// Luhn check algorithm (ISO/IEC 7812-1)
// Used by GSMA to validate IMEI numbers
function luhnCheck(imei: string): boolean {
  let sum = 0;
  for (let i = 0; i < imei.length; i++) {
    let digit = parseInt(imei[i], 10);
    // Double every second digit (from right, but since IMEI is fixed 15 digits,
    // this means odd indices when counting from left starting at 0)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// ── Hyla Mobile Gateway ──────────────────────────────────────────────
// Call Hyla to verify IMEI against a specific modelCode
// Hyla returns structured responses with error codes:
//   code 4009: "The IMEI cannot be validated with {brand}" — IMEI doesn't match the selected brand
//   code 400:  Generic bad request (missing response token, etc.)
// Even when Hyla returns an error, the trade-in value comes from the modelCode in config.json
// 
// Requires: modelCode (from config.json) + imei
// Optional: mtn (phone number), response (encrypted session token)

// Known Hyla error codes
const HYLA_ERROR_CODES: Record<number, string> = {
  4009: "IMEI does not match the selected device brand",
  4010: "IMEI is blacklisted or reported stolen",
  4011: "Device is not eligible for trade-in",
  4001: "Invalid IMEI format",
  4002: "IMEI not found in database",
  400: "Bad request (missing session token or invalid parameters)",
};

async function callHylaGateway(params: {
  modelCode: string;
  imei: string;
  mtn?: string;
  responseToken?: string;
}): Promise<{
  success: boolean;
  data: HylaResponse | null;
  status: number;
  hylaCode: number | null;
  hylaMessage: string;
  message: string;
}> {
  const queryParams = new URLSearchParams();
  queryParams.set("modelCode", params.modelCode);
  queryParams.set("imeiEsn", params.imei);
  if (params.mtn) queryParams.set("mtn", params.mtn);
  if (params.responseToken) queryParams.set("response", params.responseToken);

  const url = `${HYLA_API_BASE}${HYLA_IMEI_ENDPOINT}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://tradein.att.com",
        "Referer": "https://tradein.att.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0",
        "X-Program": HYLA_PROGRAM,
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
      },
    });

    const httpStatus = response.status;
    let data: HylaResponse | null = null;
    try {
      data = await response.json() as HylaResponse;
    } catch {
      // Response may not be JSON
    }

    // Extract Hyla-specific error code and message from response body
    const hylaCode = data?.code ? Number(data.code) : null;
    const hylaMessage = (data?.message as string) || "";

    if (response.ok && (!hylaCode || hylaCode < 4000)) {
      return {
        success: true,
        data,
        status: httpStatus,
        hylaCode,
        hylaMessage,
        message: "Hyla verification successful",
      };
    }

    // Hyla returned an error code — still useful information
    const knownError = hylaCode ? HYLA_ERROR_CODES[hylaCode] : null;

    return {
      success: false,
      data,
      status: httpStatus,
      hylaCode,
      hylaMessage: hylaMessage || knownError || "",
      message: hylaMessage || knownError || `Hyla returned HTTP ${httpStatus}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: null,
      status: 0,
      hylaCode: null,
      hylaMessage: "",
      message: `Hyla API unreachable: ${errMsg}`,
    };
  }
}

// Convert camelCase/snake_case key to readable label
function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

// Pick an icon for known fields
function getFieldIcon(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("valid") || lower.includes("eligible")) return "✅";
  if (lower.includes("blacklist") || lower.includes("stolen") || lower.includes("lost")) return "🚨";
  if (lower.includes("lock")) return "🔒";
  if (lower.includes("model") || lower.includes("device") || lower.includes("manufacturer")) return "📱";
  if (lower.includes("network") || lower.includes("sim") || lower.includes("esim")) return "📡";
  if (lower.includes("error")) return "❌";
  if (lower.includes("compat")) return "🔗";
  return "ℹ️";
}

// Match IMEI device info to trade-in catalog for value lookup
async function matchImeiToTradeIn(deviceInfo: ImeiDeviceInfo): Promise<{
  matched: boolean;
  tradeInValue?: number;
  device?: {
    brand: string;
    model: string;
    capacity: string;
    modelCode: string;
    available_capacities: Array<{ capacity: string; value: number; modelCode: string }>;
    image: string;
  };
}> {
  const data = await fetchTradeInData();
  if (!data) return { matched: false };

  const phoneCategory = data.devices.find(d => d.category === "phone");
  if (!phoneCategory) return { matched: false };

  // Try to determine brand from device info
  const brandName = deviceInfo.manufacturer || deviceInfo.brand || "";
  const modelName = deviceInfo.modelName || deviceInfo.model || "";
  const capacity = deviceInfo.capacity || "";

  if (!brandName && !modelName) return { matched: false };

  // Find brand
  const make = phoneCategory.makes.find(m =>
    m.name.toLowerCase().includes(brandName.toLowerCase()) ||
    brandName.toLowerCase().includes(m.name.toLowerCase())
  );
  if (!make) return { matched: false };

  // Find model (fuzzy match)
  const model = make.models.find(m =>
    m.name.toLowerCase().includes(modelName.toLowerCase()) ||
    modelName.toLowerCase().includes(m.name.toLowerCase())
  );
  if (!model) return { matched: false };

  // Find capacity or use first
  let selectedDevice = model.productFamily[0];
  if (capacity) {
    const match = model.productFamily.find(pf =>
      pf.capacity.toLowerCase().replace(/\s/g, "") === capacity.toLowerCase().replace(/\s/g, "")
    );
    if (match) selectedDevice = match;
  }

  return {
    matched: true,
    tradeInValue: selectedDevice.modelPrice,
    device: {
      brand: make.name,
      model: model.name,
      capacity: selectedDevice.capacity,
      modelCode: selectedDevice.modelCode,
      available_capacities: model.productFamily.map(pf => ({
        capacity: pf.capacity,
        value: pf.modelPrice,
        modelCode: pf.modelCode,
      })),
      image: selectedDevice.image,
    },
  };
}

// ============================================================
// TOOL IMPLEMENTATIONS
// ============================================================

async function searchProducts(args: {
  query?: string;
  category?: string;
  brand?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
}): Promise<Product[]> {
  const { products } = await loadCatalog();
  let filtered = [...products];

  // Exclude Internet/Fiber products from general search - these require address qualification
  filtered = filtered.filter(p => 
    p.subcategory !== 'Internet Air' && 
    p.subcategory !== 'Fiber' &&
    !p.product_id.includes('AIR') &&
    !p.product_id.includes('FIBER')
  );

  if (args.query) {
    const q = args.query.toLowerCase();
    // If searching for internet/fiber, return empty with message
    if (q.includes('internet') || q.includes('fiber') || q.includes('wifi') || q.includes('broadband')) {
      return []; // Will be handled by tool to prompt address check
    }
    filtered = filtered.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q)
    );
  }
  if (args.category) {
    filtered = filtered.filter(
      (p) => p.category?.toLowerCase() === args.category!.toLowerCase()
    );
  }
  if (args.brand) {
    filtered = filtered.filter(
      (p) => p.brand?.toLowerCase() === args.brand!.toLowerCase()
    );
  }
  if (args.min_price !== undefined) {
    filtered = filtered.filter((p) => p.price >= args.min_price!);
  }
  if (args.max_price !== undefined) {
    filtered = filtered.filter((p) => p.price <= args.max_price!);
  }

  return filtered.slice(0, args.limit || 10).map((p) => ({
    ...p,
    image: getProductImage(p.product_id),
  })) as Product[];
}

async function getPhones(args: {
  brand?: string;
  max_price?: number;
  foldable?: boolean;
  limit?: number;
}): Promise<Product[]> {
  const { products } = await loadCatalog();
  let filtered = products.filter((p) => p.category === "Phones");

  if (args.brand) {
    filtered = filtered.filter(
      (p) => p.brand?.toLowerCase() === args.brand!.toLowerCase()
    );
  }
  if (args.max_price !== undefined) {
    filtered = filtered.filter((p) => p.price <= args.max_price!);
  }
  if (args.foldable !== undefined) {
    if (args.foldable) {
      filtered = filtered.filter((p) => p.subcategory === "Foldable");
    } else {
      filtered = filtered.filter((p) => p.subcategory !== "Foldable");
    }
  }

  return filtered.slice(0, args.limit || 10).map((p) => ({
    ...p,
    image: getProductImage(p.product_id),
  })) as Product[];
}

async function getWirelessPlans(args: {
  category?: string;
  max_price?: number;
}): Promise<Plan[]> {
  const { plans } = await loadCatalog();
  let filtered = [...plans];

  if (args.category) {
    filtered = filtered.filter(
      (p) => p.category?.toLowerCase() === args.category!.toLowerCase()
    );
  }
  if (args.max_price !== undefined) {
    filtered = filtered.filter((p) => p.price_monthly <= args.max_price!);
  }

  return filtered;
}

async function getInternetPlans(args: {
  min_speed?: number;
  user_id?: string;
  include_fiber?: boolean;  // Override qualification check
}): Promise<InternetPlan[]> {
  const { internet } = await loadCatalog();
  const userId = args.user_id || "default";
  const qualification = qualificationCache[userId];
  
  let filtered = [...internet];

  // Filter based on qualification status
  if (args.include_fiber === true) {
    // Explicitly include fiber - show all fiber plans
    filtered = filtered.filter(p => p.category === 'Fiber');
  } else if (qualification) {
    // User is qualified - show plans based on their qualification
    if (qualification.fiber_available) {
      filtered = filtered.filter(p => p.category === 'Fiber');
    } else {
      filtered = filtered.filter(p => p.category === 'Internet Air');
    }
  } else {
    // No qualification - show Internet Air as default (doesn't require qualification)
    filtered = filtered.filter(p => p.category === 'Internet Air');
  }

  if (args.min_speed !== undefined) {
    filtered = filtered.filter((p) => {
      const speedNum = parseInt(String(p.speed_down).replace(/\D/g, '')) || 0;
      return speedNum >= args.min_speed!;
    });
  }

  return filtered;
}

// Check address qualification for Fiber
async function checkAddressQualification(args: {
  address: string;
  city?: string;
  state?: string;
  zip: string;
  user_id?: string;
}): Promise<{
  qualified: boolean;
  fiber_available: boolean;
  internet_air_available: boolean;
  message: string;
  available_plans: InternetPlan[];
}> {
  const { internet } = await loadCatalog();
  const userId = args.user_id || "default";
  
  // Simulate qualification check (in real app, this would call AT&T's API)
  // For demo: ZIP codes starting with 9 (West Coast) get fiber, others get Internet Air
  const fiberZips = ['90', '91', '92', '93', '94', '95', '10', '11', '12', '20', '21', '22'];
  const zipPrefix = args.zip.substring(0, 2);
  const fiberAvailable = fiberZips.includes(zipPrefix);
  
  // Store qualification
  qualificationCache[userId] = {
    address: args.address,
    zip: args.zip,
    fiber_available: fiberAvailable,
    qualified_at: new Date().toISOString(),
  };
  
  // Filter plans based on qualification
  let availablePlans: InternetPlan[];
  if (fiberAvailable) {
    availablePlans = internet.filter(p => p.category === 'Fiber');
  } else {
    availablePlans = internet.filter(p => p.category === 'Internet Air');
  }
  
  return {
    qualified: true,
    fiber_available: fiberAvailable,
    internet_air_available: !fiberAvailable,
    message: fiberAvailable 
      ? `Great news! AT&T Fiber is available at ${args.address}, ${args.zip}! You can get speeds up to 5 GIG.`
      : `AT&T Fiber is not available at ${args.address}, ${args.zip}, but AT&T Internet Air is available! Get fast 5G home internet with no installation needed.`,
    available_plans: availablePlans,
  };
}

async function getPromotions(): Promise<Promotion[]> {
  const { promotions } = await loadCatalog();
  return promotions.filter((p) => p.active);
}

async function getCart(userId: string): Promise<{
  items: CartItem[];
  item_count: number;
  subtotal: number;
  discount: number;
  promo_code: string | null;
  tax: number;
  shipping: number;
  total: number;
}> {
  const carts = await loadJson<Record<string, Cart>>(CARTS_PATH);
  if (!carts[userId]) {
    carts[userId] = { items: [], promo_code: null };
    await saveJson(CARTS_PATH, carts);
  }

  const cart = carts[userId];
  const items = cart.items || [];
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  let discount = 0;
  if (cart.promo_code) {
    const { promotions } = await loadCatalog();
    const promo = promotions.find((p) => p.code === cart.promo_code && p.active);
    if (promo && subtotal >= promo.min_order) {
      if (promo.type === "percent") {
        discount = subtotal * (promo.value / 100);
      } else {
        discount = promo.value;
      }
    }
  }

  const tax = (subtotal - discount) * 0.0825;
  const shipping = subtotal >= 35 ? 0 : 7.99;

  return {
    items,
    item_count: items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    promo_code: cart.promo_code,
    tax: Math.round(tax * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total: Math.round((subtotal - discount + tax + shipping) * 100) / 100,
  };
}

async function addToCart(args: {
  product_id: string;
  user_id?: string;
  quantity?: number;
  product_type?: string;
  color?: string;
  storage?: string;
}): Promise<{
  success: boolean;
  message: string;
  cart?: Awaited<ReturnType<typeof getCart>>;
}> {
  const userId = args.user_id || "default";
  const quantity = args.quantity || 1;
  const productType = (args.product_type || "product") as "product" | "plan" | "internet";
  const color = args.color || "";
  const storage = args.storage || "";

  const carts = await loadJson<Record<string, Cart>>(CARTS_PATH);
  if (!carts[userId]) {
    carts[userId] = { items: [], promo_code: null };
  }

  const { products, plans, internet } = await loadCatalog();

  let product: { id: string; name: string; price: number } | null = null;
  let storagePriceIncrement = 0;

  if (productType === "plan") {
    const plan = plans.find((p) => p.plan_id === args.product_id);
    if (plan) {
      product = { id: plan.plan_id, name: plan.name, price: plan.price_monthly };
    }
  } else if (productType === "internet") {
    const plan = internet.find((p) => p.plan_id === args.product_id);
    if (plan) {
      product = { id: plan.plan_id, name: plan.name, price: plan.price_monthly };
    }
  } else {
    const p = products.find((prod) => prod.product_id === args.product_id);
    if (p) {
      // Calculate storage price increment
      if (storage && p.storage_prices) {
        const priceMap = String(p.storage_prices).split('|').reduce((acc, item) => {
          const [size, increment] = item.split(':');
          acc[size.trim()] = parseInt(increment) || 0;
          return acc;
        }, {} as Record<string, number>);
        storagePriceIncrement = priceMap[storage] || 0;
      }
      product = { id: p.product_id, name: p.name, price: p.price + storagePriceIncrement };
    }
  }

  if (!product) {
    return { success: false, message: `Product ${args.product_id} not found` };
  }

  const cart = carts[userId];
  
  // Create a unique key for items with color/storage variants
  const itemKey = [args.product_id, color, storage].filter(Boolean).join("-");
  const existingItem = cart.items.find((i) => {
    const existingKey = [i.id, i.color || "", i.storage || ""].filter(Boolean).join("-");
    return existingKey === itemKey;
  });

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    // Build display name with options
    let displayName = product.name;
    const options = [color, storage].filter(Boolean);
    if (options.length > 0) {
      displayName += ` (${options.join(", ")})`;
    }
    
    cart.items.push({
      id: product.id,
      name: displayName,
      price: product.price,
      quantity,
      type: productType,
      color: color || undefined,
      storage: storage || undefined,
    });
  }

  await saveJson(CARTS_PATH, carts);
  return {
    success: true,
    message: `Added ${product.name} to cart`,
    cart: await getCart(userId),
  };
}

async function removeFromCart(args: {
  product_id: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  message: string;
  cart?: Awaited<ReturnType<typeof getCart>>;
}> {
  const userId = args.user_id || "default";
  const carts = await loadJson<Record<string, Cart>>(CARTS_PATH);

  if (!carts[userId]) {
    return { success: false, message: "Cart not found" };
  }

  const cart = carts[userId];
  const index = cart.items.findIndex((i) => i.id === args.product_id);

  if (index === -1) {
    return { success: false, message: "Item not in cart" };
  }

  const removed = cart.items.splice(index, 1)[0];
  await saveJson(CARTS_PATH, carts);
  return {
    success: true,
    message: `Removed ${removed.name}`,
    cart: await getCart(userId),
  };
}

async function applyPromo(args: {
  promo_code: string;
  user_id?: string;
}): Promise<{
  success: boolean;
  message: string;
  cart?: Awaited<ReturnType<typeof getCart>>;
}> {
  const userId = args.user_id || "default";
  const { promotions } = await loadCatalog();
  const promo = promotions.find(
    (p) => p.code.toUpperCase() === args.promo_code.toUpperCase() && p.active
  );

  if (!promo) {
    return { success: false, message: "Invalid promo code" };
  }

  const carts = await loadJson<Record<string, Cart>>(CARTS_PATH);
  if (!carts[userId]) {
    carts[userId] = { items: [], promo_code: null };
  }

  carts[userId].promo_code = promo.code.toUpperCase();
  await saveJson(CARTS_PATH, carts);

  return {
    success: true,
    message: `Applied: ${promo.description}`,
    cart: await getCart(userId),
  };
}

async function clearCart(args: {
  user_id?: string;
}): Promise<{ success: boolean; message: string }> {
  const userId = args.user_id || "default";
  const carts = await loadJson<Record<string, Cart>>(CARTS_PATH);
  carts[userId] = { items: [], promo_code: null };
  await saveJson(CARTS_PATH, carts);
  return { success: true, message: "Cart cleared" };
}

async function checkout(args: {
  shipping_address: ShippingAddress;
  user_id?: string;
  is_new_customer?: boolean;
}): Promise<{ success: boolean; message: string; order?: Order; validation_error?: string }> {
  const userId = args.user_id || "default";
  const cart = await getCart(userId);
  const isNewCustomer = args.is_new_customer ?? true; // Default to new customer

  if (cart.item_count === 0) {
    return { success: false, message: "Cart is empty" };
  }

  // Validate cart contents based on customer type
  const { plans } = await loadCatalog();
  
  const hasPhone = cart.items.some(item => item.type === "product");
  const hasPostpaidPlan = cart.items.some(item => {
    if (item.type === "plan") {
      const plan = plans.find(p => p.plan_id === item.id);
      return plan?.category === "Postpaid";
    }
    return false;
  });
  const hasBYODPlan = cart.items.some(item => {
    if (item.type === "plan") {
      const plan = plans.find(p => p.plan_id === item.id);
      return plan?.category === "BYOD";
    }
    return false;
  });

  // New customer validation
  if (isNewCustomer) {
    // New customers need both phone and plan for Postpaid
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
        message: "New customers must select a wireless plan with their phone purchase",
        validation_error: "PLAN_REQUIRED"
      };
    }
  }
  // Existing customers can buy phone only or plan only

  const required: (keyof ShippingAddress)[] = ["name", "street", "city", "state", "zip"];
  for (const field of required) {
    if (!args.shipping_address[field]) {
      return { success: false, message: `Missing: ${field}` };
    }
  }

  const orderId = `ATT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const order: Order = {
    order_id: orderId,
    user_id: userId,
    items: cart.items,
    subtotal: cart.subtotal,
    discount: cart.discount,
    tax: cart.tax,
    shipping: cart.shipping,
    total: cart.total,
    shipping_address: args.shipping_address,
    status: "confirmed",
    created_at: new Date().toISOString(),
  };

  const orders = await loadJson<Record<string, Order>>(ORDERS_PATH);
  orders[orderId] = order;
  await saveJson(ORDERS_PATH, orders);

  await clearCart({ user_id: userId });

  return { success: true, message: "Order placed!", order };
}

async function getInventorySummary(): Promise<{
  total_products: number;
  total_stock: number;
  total_value: number;
  low_stock: number;
  out_of_stock: number;
  by_category: Record<string, number>;
  by_brand: Record<string, number>;
}> {
  const { products } = await loadCatalog();

  const byCategory: Record<string, number> = {};
  const byBrand: Record<string, number> = {};

  for (const p of products) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byBrand[p.brand] = (byBrand[p.brand] || 0) + 1;
  }

  return {
    total_products: products.length,
    total_stock: products.reduce((sum, p) => sum + (p.stock || 0), 0),
    total_value: Math.round(products.reduce((sum, p) => sum + p.price * (p.stock || 0), 0) * 100) / 100,
    low_stock: products.filter((p) => p.stock <= 10).length,
    out_of_stock: products.filter((p) => p.stock === 0).length,
    by_category: byCategory,
    by_brand: byBrand,
  };
}

// ============================================================
// SERVER FACTORY
// ============================================================

export function createServer(): McpServer {
  const server = new McpServerClass({
    name: "AT&T Shopping MCP Server",
    version: "1.0.0",
  });

  const phoneBrowserUri = "ui://att-shopping/phones.html";
  const accessoriesBrowserUri = "ui://att-shopping/accessories.html";
  const planBrowserUri = "ui://att-shopping/plans.html";
  const internetBrowserUri = "ui://att-shopping/internet.html";
  const cartViewUri = "ui://att-shopping/cart.html";
  const inventoryDashboardUri = "ui://att-shopping/inventory.html";
  const storeLocatorUri = "ui://att-shopping/stores.html";

  // ===== TOOLS WITH ZOD SCHEMAS =====

  // search_products
  server.tool(
    "search_products",
    "Search AT&T products by keyword, category, brand, or price range. NOTE: For internet/fiber products, use check_address first then get_internet_plans.",
    {
      query: z.string().optional().describe("Search keyword"),
      category: z.string().optional().describe("Product category"),
      brand: z.string().optional().describe("Brand name"),
      min_price: z.number().optional().describe("Minimum price"),
      max_price: z.number().optional().describe("Maximum price"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async (args) => {
      // Check if searching for internet products
      const query = (args.query || '').toLowerCase();
      if (query.includes('internet') || query.includes('fiber') || query.includes('wifi') || query.includes('broadband') || query.includes('home internet')) {
        return { 
          content: [{ 
            type: "text", 
            text: `🏠 INTERNET SERVICE INQUIRY DETECTED

To show internet plans, I need to first check what's available at the customer's address.

Please ask the customer: "I'd be happy to help you with home internet! To see what plans are available, could you please provide your service address and ZIP code?"

Then use the 'check_address' tool with their address to determine if they qualify for:
- AT&T Fiber (fastest speeds, requires qualification)
- AT&T Internet Air (5G home internet, available in more areas)

After address qualification, use 'get_internet_plans' to show available options.`
          }] 
        };
      }
      
      const products = await searchProducts(args);
      return { content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };
    }
  );

  // get_phones - Interactive UI
  registerAppTool(
    server,
    "get_phones",
    {
      title: "Browse Phones",
      description: "Browse AT&T phones with an interactive visual catalog.",
      inputSchema: {
        brand: z.string().optional().describe("Filter by brand"),
        max_price: z.number().optional().describe("Maximum price"),
        foldable: z.boolean().optional().describe("Filter foldable phones"),
        limit: z.number().optional().describe("Max results"),
      },
      _meta: { ui: { resourceUri: phoneBrowserUri } },
    },
    async (args: { brand?: string; max_price?: number; foldable?: boolean; limit?: number }) => {
      const phones = await getPhones(args);
      return { content: [{ type: "text", text: JSON.stringify(phones, null, 2) }] };
    }
  );

  // get_accessories - Interactive UI
  registerAppTool(
    server,
    "get_accessories",
    {
      title: "Browse Accessories",
      description: "Browse AT&T accessories with an interactive visual catalog. Includes cases, chargers, headphones, and more.",
      inputSchema: {
        brand: z.string().optional().describe("Filter by brand"),
        max_price: z.number().optional().describe("Maximum price"),
        limit: z.number().optional().describe("Max results"),
      },
      _meta: { ui: { resourceUri: accessoriesBrowserUri } },
    },
    async (args: { brand?: string; max_price?: number; limit?: number }) => {
      const accessories = await searchProducts({ ...args, category: "Accessories" });
      return { content: [{ type: "text", text: JSON.stringify(accessories, null, 2) }] };
    }
  );

  // get_wireless_plans - Interactive UI
  registerAppTool(
    server,
    "get_wireless_plans",
    {
      title: "Browse Plans",
      description: "View AT&T wireless plans with an interactive comparison interface.",
      inputSchema: {
        category: z.string().optional().describe("Plan category"),
        max_price: z.number().optional().describe("Maximum monthly price"),
      },
      _meta: { ui: { resourceUri: planBrowserUri } },
    },
    async (args: { category?: string; max_price?: number }) => {
      const plans = await getWirelessPlans(args);
      return { content: [{ type: "text", text: JSON.stringify(plans, null, 2) }] };
    }
  );

  // get_internet_plans - Interactive UI (REQUIRES ADDRESS QUALIFICATION)
  registerAppTool(
    server,
    "get_internet_plans",
    {
      title: "Browse Internet Plans",
      description: "Browse AT&T internet plans. IMPORTANT: Must call check_address FIRST to qualify the customer's address before showing any internet plans. Do not show plans without address qualification.",
      inputSchema: {
        min_speed: z.number().optional().describe("Minimum speed in Mbps"),
        user_id: z.string().optional().describe("User ID for qualification lookup"),
      },
      _meta: { ui: { resourceUri: internetBrowserUri } },
    },
    async (args: { min_speed?: number; user_id?: string }) => {
      try {
        const userId = args.user_id || "default";
        const qualification = qualificationCache[userId];
        
        // STRICTLY REQUIRE ADDRESS QUALIFICATION
        if (!qualification) {
          return { 
            content: [{ 
              type: "text", 
              text: `⚠️ ADDRESS QUALIFICATION REQUIRED

Before showing internet plans, you MUST first ask the customer for their service address and use the 'check_address' tool to verify availability.

Please ask the customer:
"To show you available internet plans, I'll need to check what's available at your address. Could you please provide your street address and ZIP code?"

After getting their address, call check_address with:
- address: street address
- zip: ZIP code

Then call get_internet_plans again to show the qualified plans.

DO NOT show any internet plan information until the address is qualified.`
            }] 
          };
        }
        
        const plans = await getInternetPlans({ ...args, user_id: userId });
        
        // Return only qualified plans with clear messaging
        const response = {
          qualification_status: {
            address: qualification.address || "",
            zip: qualification.zip || "",
            fiber_available: qualification.fiber_available || false,
            qualified_at: qualification.qualified_at || "",
          },
          plans: plans || [],
          message: qualification.fiber_available 
            ? `✅ AT&T Fiber is available at ${qualification.address}, ${qualification.zip}!`
            : `✅ AT&T Internet Air is available at ${qualification.address}, ${qualification.zip}!`,
          plan_type: qualification.fiber_available ? "Fiber" : "Internet Air"
        };
        
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        console.error("Error in get_internet_plans:", error);
        return { 
          content: [{ 
            type: "text", 
            text: `Error loading internet plans. Please try again or check your address first using check_address.` 
          }] 
        };
      }
    }
  );

  // check_address - Address qualification for internet (MUST BE CALLED FIRST)
  server.tool(
    "check_address",
    "REQUIRED: Check if an address qualifies for AT&T Fiber or Internet Air. After checking, ALWAYS call get_internet_plans to show the visual product cards UI.",
    {
      address: z.string().describe("Street address"),
      city: z.string().optional().describe("City"),
      state: z.string().optional().describe("State"),
      zip: z.string().describe("ZIP code"),
      user_id: z.string().optional().describe("User ID"),
    },
    async (args) => {
      try {
        const result = await checkAddressQualification(args);
        
        const response = `
ADDRESS QUALIFIED SUCCESSFULLY!

📍 Address: ${args.address}${args.city ? ', ' + args.city : ''}${args.state ? ' ' + args.state : ''} ${args.zip}
✅ Status: ${result.fiber_available ? 'AT&T FIBER AVAILABLE' : 'AT&T INTERNET AIR AVAILABLE'}

${result.fiber_available 
  ? '🎉 Great news! This address qualifies for AT&T Fiber with speeds up to 5 GIG!'
  : '📡 AT&T Internet Air is available - fast 5G home internet with no installation needed!'}

⚠️ IMPORTANT: Now call the 'get_internet_plans' tool to display the interactive shopping UI with product cards so the customer can browse and add plans to cart.

Do NOT just list the plans in text - use get_internet_plans to show the visual interface.`;

        return { content: [{ type: "text", text: response }] };
      } catch (error) {
        console.error("Error in check_address:", error);
        return { 
          content: [{ 
            type: "text", 
            text: `Error checking address qualification. Please verify the address format and try again.` 
          }] 
        };
      }
    }
  );

  // get_promotions
  server.tool(
    "get_promotions",
    "Get current promotions and discount codes",
    {},
    async () => {
      const promos = await getPromotions();
      return { content: [{ type: "text", text: JSON.stringify(promos, null, 2) }] };
    }
  );

  // ===== TRADE-IN TOOLS (AT&T Public API) =====

  // get_tradein_brands - List available brands for trade-in
  server.tool(
    "get_tradein_brands",
    "Get list of phone brands available for trade-in. Uses AT&T's official trade-in API with real-time pricing.",
    {},
    async () => {
      try {
        const brands = await getTradeInBrands();
        return { 
          content: [{ 
            type: "text", 
            text: `📱 AVAILABLE TRADE-IN BRANDS:\n\n${brands.map(b => `• ${b}`).join('\n')}\n\nAsk for a specific brand to see available models, or use get_tradein_value to check a specific device's value.`
          }] 
        };
      } catch (error) {
        return { content: [{ type: "text", text: "Unable to fetch trade-in brands. Please try again." }] };
      }
    }
  );

  // get_tradein_models - List models for a brand
  server.tool(
    "get_tradein_models",
    "Get list of phone models available for trade-in from a specific brand.",
    {
      brand: z.string().describe("Phone brand (e.g., Apple, Samsung, Google)"),
    },
    async (args) => {
      try {
        const models = await getTradeInModels(args.brand);
        if (models.length === 0) {
          return { content: [{ type: "text", text: `No models found for brand "${args.brand}". Use get_tradein_brands to see available brands.` }] };
        }
        return { 
          content: [{ 
            type: "text", 
            text: `📱 ${args.brand.toUpperCase()} TRADE-IN MODELS:\n\n${models.map(m => `• ${m}`).join('\n')}\n\nUse get_tradein_value with model name to check specific trade-in value.`
          }] 
        };
      } catch (error) {
        return { content: [{ type: "text", text: "Unable to fetch trade-in models. Please try again." }] };
      }
    }
  );

  // get_tradein_value - Get trade-in value (REQUIRES IMEI verification)
  server.tool(
    "get_tradein_value",
    `Get trade-in value for a specific phone. REQUIRES IMEI for verification. The IMEI is verified against the claimed device via Hyla Mobile — trade-in values are ONLY shown if the IMEI matches the device. If IMEI cannot be verified, the user is directed to tradein.att.com. You can also use validate_imei (with brand + model) which does the same thing.`,
    {
      brand: z.string().describe("Phone brand (e.g., Apple, Samsung, Google). REQUIRED."),
      model: z.string().describe("Phone model (e.g., iPhone 15 Pro Max, Galaxy S24 Ultra). REQUIRED."),
      imei: z.string().describe("15-digit IMEI number. REQUIRED — trade-in values only shown after IMEI verification. Dial *#06# to find it."),
      capacity: z.string().optional().describe("Storage capacity (e.g., 256GB, 512GB)"),
      good_condition: z.boolean().optional().describe("Is device in good condition? (default: true). Bad condition = 50% of value"),
    },
    async (args) => {
      try {
        const brand = args.brand || "";
        const model = args.model || "";
        const capacity = args.capacity || "";

        if (!brand || !model) {
          return { content: [{ type: "text", text: `❌ Please provide both brand and model.\nExample: get_tradein_value with brand="Apple" model="iPhone 15 Pro Max" imei="350938243743264"` }] };
        }

        if (!args.imei) {
          return { content: [{ type: "text", text: `❌ IMEI REQUIRED FOR TRADE-IN\n\nTrade-in values can only be shown after IMEI verification.\nPlease provide your 15-digit IMEI number.\n\n💡 How to find your IMEI:\n   • Dial *#06# on the phone\n   • Check Settings > About Phone > IMEI\n   • Look on the box or under the battery\n\nExample: get_tradein_value with brand="${brand}" model="${model}" imei="your-15-digit-imei"` }] };
        }

        // Validate IMEI format
        const validation = validateImeiFormat(args.imei);
        if (!validation.valid) {
          return { content: [{ type: "text", text: `❌ INVALID IMEI\n\n🔢 ${validation.message}\n\n💡 Dial *#06# on the phone to find the correct IMEI.` }] };
        }

        const cleanImei = validation.cleanImei;
        let response = `📱 IMEI: ${cleanImei}\n`;
        response += `🔢 Luhn Checksum: ✅ Pass\n`;

        // Look up modelCode from trade-in catalog
        let modelCode = "";
        const tradeInData = await fetchTradeInData();
        if (tradeInData) {
          const phoneCategory = tradeInData.devices.find(d => d.category === "phone");
          if (phoneCategory) {
            const brandLower = brand.toLowerCase();
            const modelLower = model.toLowerCase();
            for (const make of phoneCategory.makes) {
              if (!make.name.toLowerCase().includes(brandLower)) continue;
              for (const mdl of make.models) {
                if (!mdl.name.toLowerCase().includes(modelLower)) continue;
                if (mdl.productFamily.length > 0) {
                  modelCode = mdl.productFamily[0].modelCode;
                  break;
                }
              }
              if (modelCode) break;
            }
          }
        }

        if (!modelCode) {
          return { content: [{ type: "text", text: `${response}\n🚫 TRADE-IN VALUE UNAVAILABLE\n\nCould not find ${brand} ${model} in AT&T's trade-in catalog.\n\n💡 Visit https://tradein.att.com to check your device's trade-in eligibility.` }] };
        }

        response += `🏷️ Model Code: ${modelCode}\n`;

        // Call Hyla to verify IMEI matches the device
        const hylaResult = await callHylaGateway({
          modelCode,
          imei: cleanImei,
        });

        response += `\n${"─".repeat(40)}\n`;
        response += `\n🔌 HYLA MOBILE VERIFICATION\n\n`;
        response += `📊 HTTP Status: ${hylaResult.status || "N/A"}\n`;

        if (hylaResult.hylaCode) {
          response += `🔢 Hyla Code: ${hylaResult.hylaCode}\n`;
          const knownError = HYLA_ERROR_CODES[hylaResult.hylaCode];
          if (knownError) {
            response += `📋 Meaning: ${knownError}\n`;
          }
        }

        // Gate trade-in value based on Hyla verification
        if (hylaResult.hylaCode === 4009) {
          // IMEI mismatch — BLOCK
          response += `\n❌ IMEI MISMATCH — TRADE-IN BLOCKED\n\n`;
          response += `The IMEI ${cleanImei} does NOT belong to a ${brand} ${model}.\n`;
          response += `${hylaResult.hylaMessage}\n\n`;
          response += `🚫 Trade-in value cannot be provided for a mismatched device.\n\n`;
          response += `💡 Please verify:\n`;
          response += `   • Dial *#06# to confirm your IMEI\n`;
          response += `   • Check Settings > About Phone for the correct model\n`;
          response += `   • Provide the correct brand and model for this IMEI`;
          return { content: [{ type: "text", text: response }] };
        }

        if (hylaResult.hylaCode && hylaResult.hylaCode >= 4010) {
          // Device issue — BLOCK
          response += `\n🚫 DEVICE NOT ELIGIBLE FOR TRADE-IN\n\n`;
          response += `Hyla Code: ${hylaResult.hylaCode}\n`;
          response += `${hylaResult.hylaMessage}\n\n`;
          response += `This device cannot be traded in.`;
          return { content: [{ type: "text", text: response }] };
        }

        if (!hylaResult.success && !hylaResult.hylaCode) {
          // Hyla couldn't verify (no session token, network error) — BLOCK
          response += `\n🚫 TRADE-IN VALUE UNAVAILABLE\n\n`;
          response += `Cannot confirm IMEI ${cleanImei} belongs to a ${brand} ${model}.\n`;
          response += `IMEI-to-device verification could not be completed.\n\n`;
          response += `💡 To get your verified trade-in value:\n`;
          response += `   1. Visit https://tradein.att.com\n`;
          response += `   2. Select your device model\n`;
          response += `   3. Enter your IMEI for verification\n`;
          response += `   4. Get your confirmed trade-in value\n\n`;
          response += `📞 Or visit an AT&T store for in-person trade-in assistance.\n`;
          response += `💡 Use find_att_stores with your ZIP code to find the nearest location.`;
          return { content: [{ type: "text", text: response }] };
        }

        // ✅ IMEI VERIFIED — show trade-in value
        response += `\n✅ IMEI VERIFIED: Matches ${brand} ${model}\n`;

        const result = await getTradeInValue({ brand, model, capacity, good_condition: args.good_condition });

        if (!result.success || !result.device) {
          response += `\n⚠️ IMEI is verified but ${result.message}`;
          return { content: [{ type: "text", text: response }] };
        }

        const device = result.device;
        const conditionText = args.good_condition !== false ? "Good Condition" : "Poor Condition (50% value)";

        response += `\n${"─".repeat(40)}\n`;
        response += `\n✅ VERIFIED TRADE-IN VALUE — ${device.model}\n\n`;
        response += `📱 Device: ${device.brand} ${device.model}\n`;
        response += `💾 Capacity: ${device.capacity}\n`;
        response += `✅ Condition: ${conditionText}\n\n`;
        response += `💵 TRADE-IN VALUE: $${device.condition_value}\n`;
        if (args.good_condition === false) {
          response += `   (Base value: $${device.base_value})\n`;
        }
        response += `\n📊 All Available Capacities:\n`;
        response += device.available_capacities.map(c => `   • ${c.capacity}: $${c.value}`).join('\n');
        response += `\n\n🎁 This trade-in value can be applied toward a new phone purchase!`;
        response += `\nWould you like to browse phones to see what you could upgrade to?`;

        return { content: [{ type: "text", text: response }] };
      } catch (error) {
        console.error("Trade-in error:", error);
        return { content: [{ type: "text", text: "Unable to fetch trade-in value. Please try again." }] };
      }
    }
  );

  // search_tradein - Search for trade-in devices
  server.tool(
    "search_tradein",
    "Search/browse devices in AT&T's trade-in catalog. Shows model names and general value ranges for discovery purposes only. This is NOT for processing a trade-in — to actually trade in a device, the user must provide their IMEI and use validate_imei or get_tradein_value for verified pricing.",
    {
      query: z.string().describe("Search query (e.g., 'iPhone 15', 'Galaxy', 'Pixel')"),
    },
    async (args) => {
      try {
        const results = await searchTradeInDevices(args.query);
        
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No trade-in devices found matching "${args.query}". Try a different search term or use get_tradein_brands to see available brands.` }] };
        }
        
        const response = `
🔍 TRADE-IN SEARCH RESULTS for "${args.query}"

Found ${results.length} device(s):

${results.slice(0, 10).map(d => `📱 ${d.brand} ${d.model}
   Values: ${d.capacities.map(c => `${c.capacity}: $${c.value}`).join(' | ')}
`).join('\n')}
${results.length > 10 ? `\n...and ${results.length - 10} more results` : ''}

Use get_tradein_value with specific brand and model for detailed pricing.`;

        return { content: [{ type: "text", text: response }] };
      } catch (error) {
        return { content: [{ type: "text", text: "Unable to search trade-in devices. Please try again." }] };
      }
    }
  );

  // ===== IMEI VALIDATION TOOLS (AT&T Public API) =====

  // validate_imei - Validate IMEI and verify device match
  server.tool(
    "validate_imei",
    `Validate a device IMEI number and verify it matches the claimed device. This is the PRIMARY tool for trade-in requests when a user provides an IMEI number.

CRITICAL RULES:
1. When a user provides BOTH an IMEI and device name (e.g. "IMEI 350938243743264 iPhone 15 Pro Max"), ALWAYS pass brand AND model parameters together with the IMEI in this single call.
2. NEVER call validate_imei without brand/model and then get_tradein_value separately — this bypasses IMEI verification and shows unverified values.
3. This tool handles the COMPLETE flow: Luhn checksum → Hyla Mobile IMEI-to-device verification → trade-in value (ONLY shown if IMEI matches device).
4. If the user provides an IMEI for trade-in, use ONLY this tool. Do NOT also call get_tradein_value.

IMEI must be exactly 15 digits. Users can find IMEI by dialing *#06#.`,
    {
      imei: z.string().describe("15-digit IMEI number. Dial *#06# or check Settings > About Phone."),
      brand: z.string().optional().describe("Phone brand (e.g., Apple, Samsung). STRONGLY RECOMMENDED — required for IMEI-device verification."),
      model: z.string().optional().describe("Phone model (e.g., iPhone 15 Pro Max). STRONGLY RECOMMENDED — required for IMEI-device verification."),
      model_code: z.string().optional().describe("AT&T/Hyla modelCode from trade-in catalog (e.g., 2380452)"),
      mtn: z.string().optional().describe("AT&T mobile telephone number"),
      response_token: z.string().optional().describe("Encrypted session token from tradein.att.com"),
      check_tradein: z.boolean().optional().describe("Look up trade-in value (default: true)"),
      good_condition: z.boolean().optional().describe("Device condition (default: true). false = 50% value"),
    },
    async (args) => {
      try {
        // 1. Validate IMEI format + Luhn checksum
        const validation = validateImeiFormat(args.imei);
        let response = "";

        if (!validation.valid) {
          response = `❌ INVALID IMEI\n\n`;
          response += `📱 Input: ${args.imei}\n`;
          response += `🔢 Digits: ${validation.cleanImei.length}/15\n`;
          response += `🔢 Luhn Checksum: ${validation.luhnValid ? "✅ Pass" : "❌ Fail"}\n`;
          response += `⚠️ ${validation.message}\n`;
          response += `\n💡 Tips:\n`;
          response += `   • IMEI must be exactly 15 digits\n`;
          response += `   • Dial *#06# on the phone to find it\n`;
          response += `   • Check Settings > About Phone > IMEI\n`;
          response += `   • Check the sticker under your battery or on the box`;
          return { content: [{ type: "text", text: response }] };
        }

        const cleanImei = validation.cleanImei;

        // 2. IMEI is valid — build response
        response = `✅ VALID IMEI\n\n`;
        response += `📱 IMEI: ${cleanImei}\n`;
        response += `🔢 Luhn Checksum: ✅ Pass\n`;
        response += `📋 TAC (Type Allocation Code): ${cleanImei.substring(0, 8)}\n`;
        response += `🔢 Serial: ${cleanImei.substring(8, 14)}\n`;
        response += `🔢 Check Digit: ${cleanImei[14]}\n`;

        // 3. Try to find modelCode from trade-in catalog if brand/model provided
        let modelCode = args.model_code || "";
        let catalogBrand = args.brand || "";
        let catalogModel = args.model || "";

        if (!modelCode && (args.brand || args.model)) {
          const tradeInData = await fetchTradeInData();
          if (tradeInData) {
            const phoneCategory = tradeInData.devices.find(d => d.category === "phone");
            if (phoneCategory) {
              const brandLower = (args.brand || "").toLowerCase();
              const modelLower = (args.model || "").toLowerCase();
              for (const make of phoneCategory.makes) {
                if (brandLower && !make.name.toLowerCase().includes(brandLower)) continue;
                for (const mdl of make.models) {
                  if (modelLower && !mdl.name.toLowerCase().includes(modelLower)) continue;
                  if (mdl.productFamily.length > 0) {
                    modelCode = mdl.productFamily[0].modelCode;
                    catalogBrand = make.name;
                    catalogModel = mdl.name;
                    break;
                  }
                }
                if (modelCode) break;
              }
            }
          }
        }

        if (modelCode) {
          response += `🏷️ Hyla Model Code: ${modelCode}\n`;
        }

        // 4. Attempt Hyla Mobile gateway verification if we have modelCode
        let hylaResult: Awaited<ReturnType<typeof callHylaGateway>> | null = null;
        if (modelCode) {
          hylaResult = await callHylaGateway({
            modelCode,
            imei: cleanImei,
            mtn: args.mtn,
            responseToken: args.response_token,
          });

          response += `\n${"─".repeat(40)}\n`;
          response += `\n🔌 HYLA MOBILE VERIFICATION\n\n`;
          response += `📡 Endpoint: gateway.hyla.hylamobile.com${HYLA_IMEI_ENDPOINT}\n`;
          response += `📊 HTTP Status: ${hylaResult.status || "N/A"}\n`;

          if (hylaResult.hylaCode) {
            response += `🔢 Hyla Code: ${hylaResult.hylaCode}\n`;
            const knownError = HYLA_ERROR_CODES[hylaResult.hylaCode];
            if (knownError) {
              response += `📋 Meaning: ${knownError}\n`;
            }
          }

          if (hylaResult.success) {
            response += `✅ IMEI VERIFIED: Matches ${catalogBrand} ${catalogModel}\n`;
            if (hylaResult.data) {
              for (const [key, value] of Object.entries(hylaResult.data)) {
                if (value === null || value === undefined || value === "" || key === "code" || key === "message") continue;
                if (typeof value === "object") {
                  response += `   ${formatKey(key)}: ${JSON.stringify(value)}\n`;
                } else {
                  response += `   ${getFieldIcon(key)} ${formatKey(key)}: ${value}\n`;
                }
              }
            }
          } else if (hylaResult.hylaCode === 4009) {
            // Code 4009: IMEI doesn't match the brand — meaningful mismatch detection
            response += `\n❌ IMEI MISMATCH DETECTED\n`;
            response += `📋 ${hylaResult.hylaMessage}\n`;
            response += `ℹ️ This IMEI does NOT belong to a ${catalogBrand} ${catalogModel}.\n`;
            response += `ℹ️ The user may have selected the wrong device model.\n`;
          } else if (hylaResult.hylaCode && hylaResult.hylaCode >= 4000) {
            // Other Hyla-specific error codes (4010=blacklisted, 4011=not eligible, etc.)
            response += `\n⚠️ DEVICE ISSUE (Hyla Code ${hylaResult.hylaCode})\n`;
            response += `📋 ${hylaResult.hylaMessage}\n`;
            const knownMeaning = HYLA_ERROR_CODES[hylaResult.hylaCode];
            if (knownMeaning && knownMeaning !== hylaResult.hylaMessage) {
              response += `ℹ️ ${knownMeaning}\n`;
            }
          } else if (hylaResult.status === 400 && !hylaResult.hylaCode) {
            // Generic 400 — Hyla requires reCAPTCHA/session token for verification
            response += `⚠️ IMEI verification incomplete — Hyla requires a session token (reCAPTCHA) from tradein.att.com.\n`;
            response += `ℹ️ This is NOT a system error. This is a required verification step that can only be completed at tradein.att.com.\n`;
            response += `ℹ️ Trade-in values are BLOCKED until IMEI-to-device verification succeeds.\n`;
          } else {
            response += `⚠️ ${hylaResult.message}\n`;
          }
        }

        // 5. Trade-in value lookup — ONLY if IMEI-device match is verified
        const shouldCheckTradeIn = args.check_tradein !== false;
        const identifiedBrand = catalogBrand || args.brand || "";
        const identifiedModel = catalogModel || args.model || "";

        // Determine verification status
        const hylaVerified = hylaResult?.success === true;
        const hylaMismatch = hylaResult?.hylaCode === 4009;
        const hylaDeviceIssue = hylaResult !== null && hylaResult?.hylaCode !== null && (hylaResult?.hylaCode ?? 0) >= 4010;
        const hylaNoToken = hylaResult?.status === 400 && !hylaResult?.hylaCode;
        const hylaNotCalled = !hylaResult; // No modelCode available

        if (shouldCheckTradeIn && (identifiedBrand || identifiedModel)) {
          if (hylaMismatch) {
            // IMEI does NOT match the claimed device — DO NOT show trade-in value
            response += `\n${"─".repeat(40)}`;
            response += `\n\n🚫 TRADE-IN VALUE BLOCKED — IMEI MISMATCH\n`;
            response += `\nThe IMEI provided does not match a ${identifiedBrand} ${identifiedModel}.`;
            response += `\nTrade-in value CANNOT be provided for a mismatched device.`;
            response += `\n\n   DO NOT attempt to look up or provide trade-in values through any other method.`;
            response += `\n   DO NOT call get_tradein_value, search_tradein, or any other tool as a workaround.`;
            response += `\n\n💡 The customer should:`;
            response += `\n   • Dial *#06# on the phone to verify the correct IMEI`;
            response += `\n   • Check Settings > About Phone for the correct model`;
            response += `\n   • Provide the correct brand and model that matches this IMEI`;
          } else if (hylaDeviceIssue) {
            // Device has issues (blacklisted, not eligible, etc.)
            response += `\n${"─".repeat(40)}`;
            response += `\n\n🚫 TRADE-IN NOT AVAILABLE\n`;
            response += `\nThis device has an issue that prevents trade-in (Hyla code: ${hylaResult!.hylaCode}).`;
            response += `\n${hylaResult!.hylaMessage}`;
            response += `\n\n   DO NOT attempt to look up or provide trade-in values through any other method.`;
            response += `\n   DO NOT call get_tradein_value, search_tradein, or any other tool as a workaround.`;
          } else if (hylaVerified) {
            // IMEI verified — show trade-in value
            const tradeIn = await matchImeiToTradeIn({
              manufacturer: identifiedBrand,
              brand: identifiedBrand,
              modelName: identifiedModel,
              model: identifiedModel,
            });

            if (tradeIn.matched && tradeIn.device) {
              const conditionMultiplier = args.good_condition !== false ? 1 : 0.5;
              const conditionValue = Math.round(tradeIn.tradeInValue! * conditionMultiplier);
              const conditionText = args.good_condition !== false ? "Good Condition" : "Poor Condition (50%)";

              response += `\n${"─".repeat(40)}`;
              response += `\n\n✅ IMEI VERIFIED — TRADE-IN VALUE\n`;
              response += `\n📱 Device: ${tradeIn.device.brand} ${tradeIn.device.model}`;
              response += `\n💾 Capacity: ${tradeIn.device.capacity}`;
              response += `\n🏷️ Model Code: ${tradeIn.device.modelCode || modelCode || "N/A"}`;
              response += `\n✅ Condition: ${conditionText}`;
              response += `\n\n💵 ESTIMATED TRADE-IN VALUE: $${conditionValue}`;
              if (args.good_condition === false) {
                response += `\n   (Base value: $${tradeIn.tradeInValue})`;
              }
              response += `\n\n📊 All Capacities:`;
              response += tradeIn.device.available_capacities.map(
                c => `\n   • ${c.capacity}: $${c.value} (code: ${c.modelCode})`
              ).join("");
              response += `\n\n🎁 Trade-in can be applied toward a new AT&T phone!`;
            } else {
              response += `\n\n💰 IMEI verified but no trade-in match for "${identifiedBrand} ${identifiedModel}".`;
              response += `\n   Try search_tradein to find the closest match.`;
            }
          } else if (hylaNoToken || hylaNotCalled) {
            // Could not verify — DO NOT show trade-in values without verification
            response += `\n${"─".repeat(40)}`;
            response += `\n\n🚫 TRADE-IN VALUE UNAVAILABLE — IMEI VERIFICATION REQUIRED\n`;
            response += `\n⚠️ Cannot confirm IMEI ${cleanImei} belongs to a ${identifiedBrand} ${identifiedModel}.`;
            response += `\n   IMEI-to-device verification via Hyla Mobile could not be completed.`;
            response += `\n   This is a required security step — trade-in values cannot be provided without it.`;
            response += `\n\n   DO NOT attempt to look up or provide trade-in values through any other method.`;
            response += `\n   DO NOT call get_tradein_value, search_tradein, or any other tool as a workaround.`;
            response += `\n   The trade-in value is BLOCKED until IMEI verification succeeds.`;
            response += `\n\n💡 The customer should visit https://tradein.att.com to complete IMEI verification`;
            response += `\n   and get their verified trade-in value, or use find_att_stores to locate a nearby AT&T store.`;
          }
        } else if (shouldCheckTradeIn && !identifiedBrand && !identifiedModel) {
          response += `\n\n${"─".repeat(40)}`;
          response += `\n💡 To get your trade-in value, provide your phone brand and model.`;
          response += `\n   Example: validate_imei with brand="Apple" model="iPhone 15 Pro Max"`;
        }

        return { content: [{ type: "text", text: response }] };
      } catch (error) {
        console.error("IMEI validation error:", error);
        return { content: [{ type: "text", text: "Unable to validate IMEI. Please try again." }] };
      }
    }
  );

  // ===== STORE LOCATOR TOOLS =====

  // find_att_stores - Interactive Store Locator with Map Widget
  registerAppTool(
    server,
    "find_att_stores",
    {
      title: "AT&T Store Locator",
      description: `Find AT&T store locations near a given address, ZIP code, or city/state. Uses AT&T's OneMap store locator API. Returns an interactive map widget with store details including name, address, phone, hours, store type, services, and distance.`,
      inputSchema: {
        postal: z.string().optional().describe("ZIP/postal code to search around (e.g., '37221', '75024'). Preferred location method."),
        city: z.string().optional().describe("City name (use with state). E.g., 'Nashville'"),
        state: z.string().optional().describe("State abbreviation (use with city). E.g., 'TN'"),
        lat: z.number().optional().describe("Latitude coordinate (use with lng)"),
        lng: z.number().optional().describe("Longitude coordinate (use with lat)"),
        max: z.number().optional().describe("Maximum stores to return (default: 5, max: 20)"),
        radius: z.number().optional().describe("Search radius in miles (default: 50)"),
        store_type: z.enum(["company", "authorized", "all"]).optional().describe("Store type filter: 'company' = AT&T company-owned, 'authorized' = authorized retailers, 'all' = both (default)"),
      },
      _meta: { ui: { resourceUri: storeLocatorUri } },
    },
    async (args: {
      postal?: string;
      city?: string;
      state?: string;
      lat?: number;
      lng?: number;
      max?: number;
      radius?: number;
      store_type?: "company" | "authorized" | "all";
    }) => {
      try {
        // Need at least one location parameter
        if (!args.postal && !(args.city && args.state) && !(args.lat && args.lng)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                stores: [],
                totalCount: 0,
                searchLocation: "unknown",
                error: "Location required. Provide ZIP code, city+state, or coordinates.",
              }),
            }],
          };
        }

        const maxResults = Math.min(args.max || 5, 20);
        const result = await searchAttStores({
          postal: args.postal,
          city: args.city,
          state: args.state,
          lat: args.lat,
          lng: args.lng,
          max: maxResults,
          radius: args.radius || 50,
          storeType: args.store_type || "all",
        });

        const locationDesc = args.postal || (args.city && args.state ? `${args.city}, ${args.state}` : "your location");

        // Return structured JSON for the widget to render
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              stores: result.stores,
              totalCount: result.totalCount,
              searchLocation: locationDesc,
              searchPostal: args.postal || "",
              success: result.success,
              message: result.message,
              debug: result.debug,
            }),
          }],
        };
      } catch (error) {
        console.error("Store locator error:", error);
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              stores: [],
              totalCount: 0,
              searchLocation: args.postal || (args.city && args.state ? `${args.city}, ${args.state}` : "unknown"),
              searchPostal: args.postal || "",
              success: false,
              message: `Store locator error: ${errMsg}`,
            }),
          }],
        };
      }
    }
  );

  // get_cart - Interactive UI
  registerAppTool(
    server,
    "get_cart",
    {
      title: "View Cart",
      description: "View shopping cart with interactive checkout interface",
      inputSchema: {
        user_id: z.string().optional().describe("User ID"),
      },
      _meta: { ui: { resourceUri: cartViewUri } },
    },
    async (args: { user_id?: string }) => {
      const cart = await getCart(args.user_id || "default");
      return { content: [{ type: "text", text: JSON.stringify(cart, null, 2) }] };
    }
  );

  // add_to_cart
  server.tool(
    "add_to_cart",
    "Add item to cart. Returns confirmation for Claude to communicate to user.",
    {
      product_id: z.string().describe("Product ID to add"),
      user_id: z.string().optional().describe("User ID"),
      quantity: z.number().optional().describe("Quantity (default: 1)"),
      product_type: z.string().optional().describe("product, plan, or internet"),
      color: z.string().optional().describe("Selected color"),
      storage: z.string().optional().describe("Selected storage option"),
    },
    async (args) => {
      const result = await addToCart(args);
      
      // Format response for Claude to naturally communicate
      if (result.success && result.cart) {
        const item = result.cart.items.find(i => i.id === args.product_id);
        const options = [item?.color, item?.storage].filter(Boolean).join(", ");
        const cartSummary = `
ITEM ADDED TO CART - Please inform the user naturally:

✅ Added: ${item?.name || args.product_id}
   ${options ? `Options: ${options}\n   ` : ''}Price: $${item?.price.toFixed(2) || 'N/A'}
   Quantity: ${item?.quantity || 1}

🛒 Cart Summary:
   Items: ${result.cart.item_count}
   Subtotal: $${result.cart.subtotal.toFixed(2)}
   Tax: $${result.cart.tax.toFixed(2)}
   Shipping: ${result.cart.shipping === 0 ? 'FREE' : '$' + result.cart.shipping.toFixed(2)}
   Total: $${result.cart.total.toFixed(2)}

${result.cart.promo_code ? `🏷️ Promo Applied: ${result.cart.promo_code}` : '💡 Tip: User can apply promo codes like ATT20, NEWLINE50, or FREESHIP'}

Please confirm this addition to the user in a friendly, conversational way and ask if they'd like to continue shopping or proceed to checkout.`;

        return { content: [{ type: "text", text: cartSummary }] };
      } else {
        return { content: [{ type: "text", text: `❌ Failed to add item: ${result.message}\n\nPlease inform the user about this issue and suggest alternatives.` }] };
      }
    }
  );

  // remove_from_cart
  server.tool(
    "remove_from_cart",
    "Remove item from cart. Returns confirmation for Claude to communicate to user.",
    {
      product_id: z.string().describe("Product ID to remove"),
      user_id: z.string().optional().describe("User ID"),
    },
    async (args) => {
      const result = await removeFromCart(args);
      
      if (result.success && result.cart) {
        const response = `
ITEM REMOVED FROM CART - Please inform the user naturally:

🗑️ Removed: ${result.message}

🛒 Updated Cart:
   Items: ${result.cart.item_count}
   ${result.cart.item_count > 0 ? `Total: $${result.cart.total.toFixed(2)}` : 'Cart is now empty'}

${result.cart.item_count > 0 ? 'Ask if they need anything else or want to proceed to checkout.' : 'Suggest some products they might be interested in.'}`;

        return { content: [{ type: "text", text: response }] };
      } else {
        return { content: [{ type: "text", text: `❌ ${result.message}\n\nPlease inform the user about this issue.` }] };
      }
    }
  );

  // apply_promo
  server.tool(
    "apply_promo",
    "Apply promo code to cart. Returns confirmation for Claude to communicate to user.",
    {
      promo_code: z.string().describe("Promo code"),
      user_id: z.string().optional().describe("User ID"),
    },
    async (args) => {
      const result = await applyPromo(args);
      
      if (result.success && result.cart) {
        const response = `
PROMO CODE APPLIED - Please inform the user naturally:

🎉 Success! ${result.message}

🛒 Updated Cart:
   Subtotal: $${result.cart.subtotal.toFixed(2)}
   Discount: -$${result.cart.discount.toFixed(2)} ✨
   Tax: $${result.cart.tax.toFixed(2)}
   Shipping: ${result.cart.shipping === 0 ? 'FREE' : '$' + result.cart.shipping.toFixed(2)}
   New Total: $${result.cart.total.toFixed(2)}

Please congratulate the user on their savings and ask if they're ready to checkout!`;

        return { content: [{ type: "text", text: response }] };
      } else {
        return { content: [{ type: "text", text: `❌ Promo code "${args.promo_code}" is invalid.\n\nPlease inform the user and suggest valid codes: ATT20 (20% off), NEWLINE50 ($50 off new lines), FREESHIP (free shipping).` }] };
      }
    }
  );

  // clear_cart
  server.tool(
    "clear_cart",
    "Clear all items from cart",
    {
      user_id: z.string().optional().describe("User ID"),
    },
    async (args) => {
      const result = await clearCart(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // checkout
  server.tool(
    "checkout",
    "Complete checkout with shipping address. IMPORTANT: First ask if customer is new or existing. New customers must have both phone + plan for Postpaid. Returns order confirmation for Claude to communicate to user.",
    {
      user_id: z.string().optional().describe("User ID"),
      is_new_customer: z.boolean().describe("Is this a new AT&T customer? Must ask user before checkout."),
      shipping_address: z.object({
        name: z.string().describe("Full name"),
        street: z.string().describe("Street address"),
        city: z.string().describe("City"),
        state: z.string().describe("State"),
        zip: z.string().describe("ZIP code"),
      }).describe("Shipping address"),
    },
    async (args) => {
      const result = await checkout(args as Parameters<typeof checkout>[0]);
      
      if (result.success && result.order) {
        const order = result.order;
        const response = `
🎊 ORDER CONFIRMED - Please congratulate the user!

Order ID: ${order.order_id}
Status: ${order.status.toUpperCase()}
Customer Type: ${args.is_new_customer ? 'NEW CUSTOMER' : 'EXISTING CUSTOMER'}

📦 Items Ordered:
${order.items.map(i => `   • ${i.name} (x${i.quantity}) - $${(i.price * i.quantity).toFixed(2)}`).join('\n')}

💰 Payment Summary:
   Subtotal: $${order.subtotal.toFixed(2)}
   ${order.discount > 0 ? `Discount: -$${order.discount.toFixed(2)}\n   ` : ''}Tax: $${order.tax.toFixed(2)}
   Shipping: ${order.shipping === 0 ? 'FREE' : '$' + order.shipping.toFixed(2)}
   Total Charged: $${order.total.toFixed(2)}

📍 Shipping To:
   ${order.shipping_address.name}
   ${order.shipping_address.street}
   ${order.shipping_address.city}, ${order.shipping_address.state} ${order.shipping_address.zip}

Please thank the user for their order and let them know they'll receive a confirmation email. Wish them a great day!`;

        return { content: [{ type: "text", text: response }] };
      } else {
        // Handle validation errors with helpful messages
        let errorMessage = `❌ Checkout failed: ${result.message}\n\n`;
        
        if (result.validation_error === "PHONE_REQUIRED") {
          errorMessage += `📱 NEW CUSTOMER REQUIREMENT:
New AT&T customers must purchase a phone with Unlimited plans.

Options:
1. Add a phone to your cart (Show me phones)
2. Switch to a BYOD plan if you have your own device (Show me BYOD plans)
3. If you're an existing customer, let me know and we can proceed`;
        } else if (result.validation_error === "PLAN_REQUIRED") {
          errorMessage += `📋 NEW CUSTOMER REQUIREMENT:
New AT&T customers must select a wireless plan with their phone purchase.

Options:
1. Add an Unlimited plan (Show me wireless plans)
2. Add a BYOD plan if you're bringing your own device
3. If you're an existing customer, let me know and we can proceed`;
        } else {
          errorMessage += "Please help the user resolve this issue.";
        }
        
        return { content: [{ type: "text", text: errorMessage }] };
      }
    }
  );

  // get_inventory_summary - Interactive UI
  registerAppTool(
    server,
    "get_inventory_summary",
    {
      title: "Inventory Dashboard",
      description: "View inventory statistics with an interactive dashboard",
      inputSchema: {},
      _meta: { ui: { resourceUri: inventoryDashboardUri } },
    },
    async () => {
      const summary = await getInventorySummary();
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ===== UI RESOURCES =====

  registerAppResource(server, phoneBrowserUri, phoneBrowserUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: phoneBrowserUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, accessoriesBrowserUri, accessoriesBrowserUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: accessoriesBrowserUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, planBrowserUri, planBrowserUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: planBrowserUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, internetBrowserUri, internetBrowserUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: internetBrowserUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, cartViewUri, cartViewUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: cartViewUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, inventoryDashboardUri, inventoryDashboardUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: inventoryDashboardUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, storeLocatorUri, storeLocatorUri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: storeLocatorUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  return server;
}
