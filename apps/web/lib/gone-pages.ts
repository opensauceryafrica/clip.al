/**
 * Minimal, dependency-free HTML responses for the redirect hot path. No React,
 * no app CSS pipeline — pure inline-styled HTML so these stay as cheap as the
 * 302 success path. No user input is ever reflected into the markup.
 */

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    font: 400 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #fafafa; color: #09090b;
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) { body { background: #09090b; color: #fafafa; } }
  main {
    max-width: 28rem; margin: 1.5rem; padding: 2rem;
    border: 1px solid #e4e4e7; border-radius: 8px; background: #fff;
  }
  @media (prefers-color-scheme: dark) { main { background: #18181b; border-color: #27272a; } }
  .brand { font-family: ui-monospace, monospace; font-size: 13px; color: #71717a; letter-spacing: -0.01em; }
  h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; margin: 1rem 0 0.5rem; }
  p { color: #52525b; margin: 0 0 1rem; }
  @media (prefers-color-scheme: dark) { p { color: #a1a1aa; } }
  a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
`;

function page(status: number, title: string, heading: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · clip.al</title><style>${BASE_STYLE}</style></head>
<body><main><div class="brand">clip.al</div><h1>${heading}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function notFound(): Response {
  return page(
    404,
    'Link not found',
    'This link doesn’t exist',
    `<p>The short link you followed isn’t valid or was never created.</p><p><a href="https://clip.al">Go to clip.al</a></p>`,
  );
}

export function goneDisabled(): Response {
  return page(
    410,
    'Link disabled',
    'This link has been disabled',
    `<p>The owner or a clip.al moderator turned this link off. It no longer redirects.</p><p><a href="https://clip.al">Go to clip.al</a></p>`,
  );
}

export function goneSafety(): Response {
  return page(
    410,
    'Link blocked for safety',
    'This link was blocked for safety',
    `<p>clip.al’s safety checks flagged the destination of this link as suspicious or malicious, so it has been blocked to protect you.</p><p><a href="https://clip.al">Go to clip.al</a></p>`,
  );
}

export function unavailable(): Response {
  return page(
    503,
    'Temporarily unavailable',
    'Temporarily unavailable',
    `<p>We couldn’t resolve this link right now. Please try again in a moment.</p>`,
  );
}
