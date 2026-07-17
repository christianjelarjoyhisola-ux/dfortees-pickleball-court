export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/runtime-config.js') {
      const config = {
        supabaseUrl: env.PB_SUPABASE_URL || 'https://dfortees-backend.invalid',
        supabasePublishableKey:
          env.PB_SUPABASE_PUBLISHABLE_KEY || 'DFORTEES_SUPABASE_PUBLISHABLE_KEY_NOT_CONFIGURED',
      };
      const serialized = JSON.stringify(config).replaceAll('<', '\\u003c');
      return new Response(`window.PB_RUNTIME_CONFIG = Object.freeze(${serialized});\n`, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // Cloudflare Pages resolves extensionless HTML routes through the asset
    // binding. Redirecting /host to /host.html here conflicts with Pages'
    // canonical /host.html -> /host redirect and creates a redirect loop.
    return env.ASSETS.fetch(request);
  },
};
