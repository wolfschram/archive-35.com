const INDEXNOW_KEY = "18ec60561b312a029d7821d84812a085";
const KEY_PATH = `${INDEXNOW_KEY}.txt`;

export function onRequest(context) {
  if (context.params.verification === KEY_PATH) {
    return new Response(`${INDEXNOW_KEY}\n`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  }
  return context.next();
}
