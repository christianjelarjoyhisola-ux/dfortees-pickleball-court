export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/runtime-config.js') {
      const expectedSupabaseUrl = 'https://ebykgvvjsuawawdheyil.supabase.co';
      const configuredSupabaseUrl = String(env.PB_SUPABASE_URL || '').replace(/\/+$/, '');
      const isExpectedProject = configuredSupabaseUrl === expectedSupabaseUrl;
      const config = {
        supabaseUrl: isExpectedProject
          ? expectedSupabaseUrl
          : 'https://dfortees-backend.invalid',
        supabasePublishableKey:
          isExpectedProject && env.PB_SUPABASE_PUBLISHABLE_KEY
            ? env.PB_SUPABASE_PUBLISHABLE_KEY
            : 'DFORTEES_SUPABASE_PUBLISHABLE_KEY_NOT_CONFIGURED',
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

    // Cached copies of the previous brand configuration may still request the
    // former logo URL. Always resolve that legacy path to the current brand so
    // repeat visitors cannot see a mixture of old and new logos.
    if (url.pathname === '/logodfortees.jpg') {
      return Response.redirect(new URL('/logonewnew.png', url).toString(), 301);
    }

    // Cloudflare Pages resolves extensionless HTML routes through the asset
    // binding. Redirecting /host to /host.html here conflicts with Pages'
    // canonical /host.html -> /host redirect and creates a redirect loop.
    return env.ASSETS.fetch(request);
  },
};
