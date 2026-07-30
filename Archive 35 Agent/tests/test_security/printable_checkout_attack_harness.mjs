import { pathToFileURL } from "node:url";

const root = process.argv[2];
const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const catalog = await load("functions/api/printable/catalog.js");
const checkout = await load("functions/api/printable/checkout.js");

const paid = {
  payment_status: "paid",
  currency: "usd",
  amount_subtotal: 900,
  amount_total: 900,
  total_details: { amount_discount: 0, amount_tax: 0 },
  metadata: {
    orderType: "printable",
    printableSku: "A35-DIG-ANT-0001",
    printablePriceCents: "900",
  },
};
if (!catalog.hasValidPrintableEntitlement(paid)) {
  throw new Error("A valid paid printable session was rejected");
}
if (catalog.hasValidPrintableEntitlement({ ...paid, amount_subtotal: 1, amount_total: 1 })) {
  throw new Error("A one-cent session received a printable entitlement");
}
if (!catalog.hasValidPrintableEntitlement({
  ...paid,
  amount_total: 974,
  total_details: { amount_discount: 0, amount_tax: 74 },
})) {
  throw new Error("A legitimate tax-inclusive total was rejected");
}
if (catalog.hasValidPrintableEntitlement({
  ...paid,
  amount_total: 675,
  total_details: { amount_discount: 225, amount_tax: 0 },
})) {
  throw new Error("A discounted session received an unsupported entitlement");
}
if (
  catalog.hasValidPrintableEntitlement({
    ...paid,
    metadata: { ...paid.metadata, printableSku: "../../secret" },
  })
) {
  throw new Error("A path-like SKU received a printable entitlement");
}

let stripeParams;
globalThis.fetch = async (_url, options) => {
  stripeParams = new URLSearchParams(options.body);
  return {
    ok: true,
    json: async () => ({ id: "cs_live_safe", url: "https://checkout.stripe.test" }),
  };
};
const request = new Request("https://archive-35.com/api/printable/checkout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sku: "A35-DIG-ANT-0001",
    price_cents: 1,
    r2_key: "../../secret",
    testMode: true,
  }),
});
const response = await checkout.onRequestPost({
  request,
  env: {
    STRIPE_SECRET_KEY: "sk_live_server",
    STRIPE_TEST_SECRET_KEY: "sk_test_server",
    ORIGINALS: {
      head: async () => ({
        size: 46896859,
        customMetadata: {
          sha256: "d274b9bea67630a36ebe3da3dc3ecbfab2dc37c551cf0c039508bd1058c7abf9",
        },
      }),
    },
  },
});
if (response.status !== 200) throw new Error(`Checkout failed with ${response.status}`);
if (stripeParams.get("line_items[0][price_data][unit_amount]") !== "900") {
  throw new Error("Client-controlled price reached Stripe");
}
if (stripeParams.has("allow_promotion_codes")) {
  throw new Error("Promotion codes are incompatible with strict entitlement pricing");
}
if (stripeParams.get("line_items[0][price_data][product_data][tax_code]") !== "txcd_10501000") {
  throw new Error("Printable-specific tax code is missing");
}
if (stripeParams.get("shipping_address_collection[allowed_countries][0]") !== "US") {
  throw new Error("Direct checkout is not limited to the registered U.S. market");
}
if (stripeParams.get("metadata[printableSku]") !== "A35-DIG-ANT-0001") {
  throw new Error("Server-owned SKU was not written to metadata");
}

let stripeCalls = 0;
globalThis.fetch = async () => {
  stripeCalls += 1;
  throw new Error("Blocked test session reached Stripe");
};
for (const endpoint of ["download.js", "serve.js"]) {
  const module = await load(`functions/api/printable/${endpoint}`);
  const blocked = await module.onRequest({
    request: new Request(
      `https://archive-35.com/api/printable/${endpoint}?session_id=cs_test_free`
    ),
    env: { STRIPE_TEST_SECRET_KEY: "sk_test_server" },
  });
  if (blocked.status !== 403) throw new Error(`${endpoint} allowed production test delivery`);
}
if (stripeCalls !== 0) throw new Error("Blocked session triggered a Stripe call");
