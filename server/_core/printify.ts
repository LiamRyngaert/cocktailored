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
    logError("printify", "API request failed", { path, status: res.status, body: body.slice(0, 500) });
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
  variants: Array<{ id: number; price: number; title: string; is_enabled: boolean }>;
};

export async function createProduct(params: {
  title: string;
  description: string;
  blueprintId: number;
  printProviderId: number;
  imageId: string;
  variants: Array<{ id: number; price: number; isEnabled: boolean }>;
  placeholderPosition: string;
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
              images: [{ id: params.imageId, x: 0.5, y: 0.5, scale: 1, angle: 0 }],
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

export function isPrintifyConfigured(): boolean {
  return !!ENV.printifyApiToken;
}
