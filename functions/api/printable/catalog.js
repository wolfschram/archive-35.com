const SALE_END = Date.parse("2026-08-07T07:00:00Z");

export const PRINTABLE_PRODUCTS = Object.freeze({
  "A35-DIG-ANT-0001": Object.freeze({
    title: "Crimson Passage Through Stone",
    slug: "antelope-canyon-printable-wall-art",
    bytes: 46896859,
    sha256: "d274b9bea67630a36ebe3da3dc3ecbfab2dc37c551cf0c039508bd1058c7abf9",
  }),
  "A35-DIG-ICE-0001": Object.freeze({
    title: "Vestrahorn's Reflection in Still Waters",
    slug: "iceland-mountain-printable-wall-art",
    bytes: 50633861,
    sha256: "d66a909453de5bf6c4d3eea9490af107a24d9811d2df1f14d57949ca4ef7f3e9",
  }),
  "A35-DIG-TAN-0001": Object.freeze({
    title: "Mother and Child in Motion",
    slug: "baboon-mother-baby-printable-wall-art",
    bytes: 63515480,
    sha256: "3d532dc189e8f638177cfcee7d4b2db9364b8295b30f13927903d35c1ced6cd9",
  }),
  "A35-DIG-TET-0001": Object.freeze({
    title: "Teton Range Winter Reflection",
    slug: "grand-teton-printable-wall-art",
    bytes: 80566844,
    sha256: "20f9a2302ac90ddeff6844ab93965bc65b3145020b6b9fafb0f1374512848ec3",
  }),
  "A35-DIG-DUN-0001": Object.freeze({
    title: "Desert Dunes in Motion",
    slug: "neutral-desert-dunes-printable-wall-art",
    bytes: 81501560,
    sha256: "a1fdd4ec972c3ae6ce68eea74df69fcef15c6c7116030b269cc4eb33a40281bd",
  }),
});

export function getPrintable(sku) {
  const product = PRINTABLE_PRODUCTS[sku];
  if (!product) return null;
  return {
    sku,
    ...product,
    r2Key: `printables/${sku}/archive-35-${sku}.zip`,
    filename: `archive-35-${sku}.zip`,
  };
}

export function currentPriceCents(now = Date.now()) {
  return now < SALE_END ? 900 : 1200;
}

export function hasValidPrintableEntitlement(session) {
  const metadata = session.metadata || {};
  const product = getPrintable(metadata.printableSku);
  if (
    metadata.orderType !== "printable" ||
    !product ||
    session.payment_status !== "paid" ||
    session.currency !== "usd"
  ) {
    return null;
  }
  const subtotal = Number(session.amount_subtotal);
  const total = Number(session.amount_total);
  const metadataPrice = Number(metadata.printablePriceCents);
  const discount = Number(session.total_details?.amount_discount || 0);
  if (
    (subtotal !== 900 && subtotal !== 1200) ||
    metadataPrice !== subtotal ||
    discount !== 0 ||
    total < subtotal
  ) {
    return null;
  }
  return product;
}

export async function onRequestGet() {
  const priceCents = currentPriceCents();
  const products = Object.keys(PRINTABLE_PRODUCTS).map((sku) => {
    const product = getPrintable(sku);
    return {
      sku,
      title: product.title,
      page: `/printable-${product.slug}.html`,
      price_usd: priceCents / 100,
      instant_download: true,
      physical_item: false,
    };
  });
  return Response.json(
    { currency: "USD", price_usd: priceCents / 100, products },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
