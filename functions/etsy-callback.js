/**
 * Etsy OAuth Callback Handler
 *
 * Cloudflare Pages Function that captures the OAuth authorization code
 * from Etsy's redirect and displays it for manual entry into Agent Settings.
 *
 * Route: https://archive-35.com/etsy-callback?code=xxx&state=yyy
 *
 * This page does NOT auto-submit the code — Wolf copies it into the Agent
 * Settings tab, which calls POST /etsy/oauth/callback on the local Agent API.
 */

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  const errorDescription = url.searchParams.get('error_description') || '';

  // If Etsy returned an error
  if (error) {
    return new Response(renderPage({
      title: 'Etsy Authorization Failed',
      message: `Error: ${error}${errorDescription ? ` — ${errorDescription}` : ''}`,
      code: '',
      state: '',
      isError: true,
    }), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      status: 400,
    });
  }

  // Missing code
  if (!code) {
    return new Response(renderPage({
      title: 'Missing Authorization Code',
      message: 'No authorization code received from Etsy. Please try the OAuth flow again from Agent Settings.',
      code: '',
      state: '',
      isError: true,
    }), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      status: 400,
    });
  }

  // Success — show the code for manual copy
  return new Response(renderPage({
    title: 'Etsy Authorization Successful',
    message: 'Copy the authorization code below and paste it into Agent Settings → Etsy → "Enter Auth Code".',
    code,
    state,
    isError: false,
  }), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function renderPage({ title, message, code, state, isError }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Archive-35</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      max-width: 520px; width: 100%;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; padding: 40px;
      text-align: center;
    }
    .logo { font-size: 28px; font-weight: 700; color: #d4a574; margin-bottom: 8px; }
    .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
    h1 { font-size: 20px; margin-bottom: 12px; color: ${isError ? '#f87171' : '#4ade80'}; }
    .message { font-size: 14px; line-height: 1.6; color: #aaa; margin-bottom: 24px; }
    .code-box {
      background: rgba(0,0,0,0.3); border: 1px solid rgba(212,165,116,0.3);
      border-radius: 8px; padding: 16px; margin-bottom: 16px;
      word-break: break-all; font-family: monospace; font-size: 14px;
      color: #d4a574; user-select: all; cursor: text;
    }
    .copy-btn {
      background: rgba(212,165,116,0.15); border: 1px solid #d4a574;
      color: #d4a574; padding: 10px 24px; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: background 0.2s;
    }
    .copy-btn:hover { background: rgba(212,165,116,0.25); }
    .copy-btn:active { transform: scale(0.98); }
    .state-info { font-size: 11px; color: #555; margin-top: 16px; }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    .success-icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Archive-35</div>
    <div class="subtitle">Etsy Integration</div>

    ${isError
      ? '<div class="error-icon">&#10060;</div>'
      : '<div class="success-icon">&#9989;</div>'}

    <h1>${title}</h1>
    <p class="message">${message}</p>

    ${code ? `
      <div class="code-box" id="code-text">${code}</div>
      <button class="copy-btn" onclick="copyCode()">Copy Code</button>
      ${state ? `<div class="state-info">State: ${state}</div>` : ''}

      <script>
        function copyCode() {
          const text = document.getElementById('code-text').textContent;
          navigator.clipboard.writeText(text).then(() => {
            const btn = document.querySelector('.copy-btn');
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy Code'; }, 2000);
          });
        }
      </script>
    ` : ''}
  </div>
</body>
</html>`;
}
