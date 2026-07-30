import fs from "node:fs";

const root = process.argv[2];
const load = async (path) => {
  const source = fs.readFileSync(`${root}/${path}`, "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};

const checkout = await load("functions/api/micro-license/checkout.js");
let authorization = "";
globalThis.fetch = async (_url, options) => {
  authorization = options.headers.Authorization;
  return { json: async () => ({ id: "cs_live_safe", url: "https://checkout.test" }) };
};
const request = new Request("https://archive-35.com/api/micro-license/checkout", {
  method: "POST",
  body: JSON.stringify({ image_id: "alps-001", tier: "web", testMode: true }),
});
const checkoutResponse = await checkout.onRequestPost({
  request,
  env: {
    STRIPE_SECRET_KEY: "sk_live_server",
    STRIPE_TEST_SECRET_KEY: "sk_test_server",
    ORIGINALS: { head: async () => ({ size: 1 }) },
  },
});
if (checkoutResponse.status !== 200 || authorization !== "Bearer sk_live_server") {
  throw new Error("Public testMode selected the test Stripe key");
}

let verificationCalls = 0;
globalThis.fetch = async () => {
  verificationCalls += 1;
  throw new Error("Test session should be blocked before verification");
};
for (const path of ["download.js", "serve.js"]) {
  const module = await load(`functions/api/micro-license/${path}`);
  const response = await module.onRequest({
    request: new Request(`https://archive-35.com/api/micro-license/${path}?session_id=cs_test_free`),
    env: { STRIPE_TEST_SECRET_KEY: "sk_test_server" },
  });
  if (response.status !== 403) throw new Error(`${path} allowed production test delivery`);
}
if (verificationCalls !== 0) throw new Error("Blocked test session reached Stripe");
