const INDEXNOW_KEY = "18ec60561b312a029d7821d84812a085";

export function onRequest() {
  return new Response(`${INDEXNOW_KEY}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
