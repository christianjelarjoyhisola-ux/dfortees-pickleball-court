export default {
  fetch(request, env) {
    // Cloudflare Pages resolves extensionless HTML routes through the asset
    // binding. Redirecting /host to /host.html here conflicts with Pages'
    // canonical /host.html -> /host redirect and creates a redirect loop.
    return env.ASSETS.fetch(request);
  },
};
