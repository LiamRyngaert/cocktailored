import { ENV } from "./env";
import { logError, logInfo } from "./reliability";

const API_BASE = "https://api.printify.com/v1";

async function printifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!ENV.printifyApiToken) {
    throw new Error("PRINTIFY_API_TOKEN is not configured");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ENV.printifyApiToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Log the request payload too (truncated) — Printify's 500s carry no
    // detail, so the payload is the only way to diagnose what it rejects.
    // Image uploads are excluded: their payload is megabytes of base64.
    const sentBody = typeof init?.body === "string" && !path.includes("/uploads/") ? init.body.slice(0, 1500) : undefined;
    logError("printify", "API request failed", { path, status: res.status, body: body.slice(0, 500), sentBody });
    throw new Error(`Printify API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export type PrintifyPrintProvider = { id: number; title: string };
export type PrintifyVariant = {
  id: number;
  title: string;
  options: Record<string, unknown>;
  placeholders?: Array<{ position: string; height: number; width: number }>;
};

export async function getShops(): Promise<Array<{ id: number; title: string; sales_channel: string }>> {
  return printifyFetch("/shops.json");
}

export async function getPrintProviders(blueprintId: number): Promise<PrintifyPrintProvider[]> {
  return printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers.json`);
}

export async function getVariants(
  blueprintId: number,
  printProviderId: number
): Promise<{ variants: PrintifyVariant[] }> {
  return printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`);
}

export async function uploadImage(fileName: string, base64Contents: string): Promise<{ id: string; preview_url: string }> {
  return printifyFetch("/uploads/images.json", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, contents: base64Contents }),
  });
}

export type PrintifyProductImage = { src: string; variant_ids: number[]; is_default: boolean };

export type PrintifyProduct = {
  id: string;
  title: string;
  images: PrintifyProductImage[];
  // cost = Printify's manufacturing cost in cents (excl. shipping).
  // price = what we set the variant to charge — cost + our margin.
  variants: Array<{ id: number; price: number; cost: number; title: string; is_enabled: boolean }>;
};

export async function createProduct(params: {
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  imageId: string;
  variants: Array<{ id: number; price: number; isEnabled: boolean }>;
  placeholderPosition: string;
  // Printify scale semantics: 1 = image width fills the full print-area
  // width. For wide print areas (e.g. a mug's wraparound) a square image
  // at scale 1 overflows vertically and gets cropped, so callers pass a
  // computed contain-fit scale instead of a hardcoded 1.
  imageScale: number;
}): Promise<PrintifyProduct> {
  return printifyFetch(`/shops/${ENV.printifyShopId}/products.json`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      blueprint_id: params.blueprintId,
      print_provider_id: params.printProviderId,
      variants: params.variants.map((v) => ({ id: v.id, price: v.price, is_enabled: v.isEnabled })),
      print_areas: [
        {
          variant_ids: params.variants.map((v) => v.id),
          placeholders: [
            {
              position: params.placeholderPosition,
              images: [{ id: params.imageId, x: 0.5, y: 0.5, scale: params.imageScale, angle: 0 }],
            },
          ],
        },
      ],
    }),
  });
}

export async function getProduct(productId: string): Promise<PrintifyProduct> {
  return printifyFetch(`/shops/${ENV.printifyShopId}/products/${productId}.json`);
}

// Sets each variant's retail price directly (used right after creation, once
// we know Printify's real per-variant manufacturing cost, to price it at
// cost + our margin instead of a guessed flat price).
export async function updateProductVariantPrices(
  productId: string,
  variants: Array<{ id: number; price: number; isEnabled: boolean }>
): Promise<PrintifyProduct> {
  return printifyFetch(`/shops/${ENV.printifyShopId}/products/${productId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      variants: variants.map((v) => ({ id: v.id, price: v.price, is_enabled: v.isEnabled })),
    }),
  });
}

export type PrintifyShippingCosts = {
  standard?: number; express?: number; priority?: number;
  printify_express?: number; economy?: number;
};

// Destination-dependent, so this is only ever called once the admin has
// entered a delivery address in the order form — never speculatively.
export async function getShippingCost(params: {
  lineItems: Array<{ productId: string; variantId: number; quantity: number }>;
  addressTo: {
    firstName: string; lastName: string; email: string; phone: string;
    country: string; region: string; address1: string; city: string; zip: string;
  };
}): Promise<PrintifyShippingCosts> {
  return printifyFetch(`/shops/${ENV.printifyShopId}/orders/shipping.json`, {
    method: "POST",
    body: JSON.stringify({
      line_items: params.lineItems.map((li) => ({
        product_id: li.productId,
        variant_id: li.variantId,
        quantity: li.quantity,
      })),
      address_to: {
        first_name: params.addressTo.firstName,
        last_name: params.addressTo.lastName,
        email: params.addressTo.email,
        phone: params.addressTo.phone,
        country: params.addressTo.country,
        region: params.addressTo.region,
        address1: params.addressTo.address1,
        city: params.addressTo.city,
        zip: params.addressTo.zip,
      },
    }),
  });
}

// Places a real, paid print order — charges the payment method on file in
// Printify. Never call this speculatively; only in direct response to an
// explicit admin action.
export async function createOrder(params: {
  lineItems: Array<{ productId: string; variantId: number; quantity: number }>;
  addressTo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    country: string;
    region: string;
    address1: string;
    city: string;
    zip: string;
  };
  shippingMethod: number;
}): Promise<{ id: string; status: string }> {
  const result = await printifyFetch<{ id: string; status: string }>(`/shops/${ENV.printifyShopId}/orders.json`, {
    method: "POST",
    body: JSON.stringify({
      line_items: params.lineItems.map((li) => ({
        product_id: li.productId,
        variant_id: li.variantId,
        quantity: li.quantity,
      })),
      shipping_method: params.shippingMethod,
      send_shipping_notification: false,
      address_to: {
        first_name: params.addressTo.firstName,
        last_name: params.addressTo.lastName,
        email: params.addressTo.email,
        phone: params.addressTo.phone,
        country: params.addressTo.country,
        region: params.addressTo.region,
        address1: params.addressTo.address1,
        city: params.addressTo.city,
        zip: params.addressTo.zip,
      },
    }),
  });
  logInfo("printify", "order placed", { orderId: result.id });
  return result;
}

// Submitting an order via createOrder() only creates a draft — Printify does
// NOT charge the payment method or start manufacturing until this separate
// call. Every real purchase must call both, in sequence.
export async function sendOrderToProduction(orderId: string): Promise<{ id: string; status: string }> {
  const result = await printifyFetch<{ id: string; status: string }>(
    `/shops/${ENV.printifyShopId}/orders/${orderId}/send_to_production.json`,
    { method: "POST" }
  );
  logInfo("printify", "order sent to production (charged)", { orderId: result.id });
  return result;
}

export function isPrintifyConfigured(): boolean {
  return !!ENV.printifyApiToken;
}
