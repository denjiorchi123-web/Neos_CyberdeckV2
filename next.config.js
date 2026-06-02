/** @type {import('next').NextConfig} */

// Build the allowed-hostname list dynamically so the app works on:
//   - Windows dev:    localhost
//   - Pi (hostname):  cyberdeck.local, deck-01.local, etc.
//   - Pi (bat0 IP):   10.0.0.x
//   - Pi (static IP): any LAN address set in NEXT_PUBLIC_SITE_URL
const allowedHostnames = new Set(["localhost"]);
if (process.env.NEXT_PUBLIC_SITE_URL) {
  try {
    allowedHostnames.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname);
  } catch {}
}
// Accept all .local mDNS names and the bat0 10.0.0.x range used by batman-adv
const remotePatterns = [...allowedHostnames].flatMap(h => [
  { protocol: "http",  hostname: h },
  { protocol: "https", hostname: h },
]);
// Wildcard for *.local mDNS names (avahi on Pi)
remotePatterns.push(
  { protocol: "http",  hostname: "*.local" },
  { protocol: "https", hostname: "*.local" }
);

const nextConfig = {
  webpack: (config) => {
    config.externals.push({
      "utf-8-validate": "commonjs utf-8-validate",
      bufferutil: "commonjs bufferutil"
    });

    // Fix Watchpack EINVAL errors on Windows by ignoring protected root files
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/DumpStack.log.tmp",
        "**/hiberfil.sys",
        "**/swapfile.sys",
        "**/pagefile.sys",
        "**/node_modules/**",
        "**/.next/**",
        "**/.git/**"
      ],
    };

    return config;
  },
  images: {
    remotePatterns,
    // Disable optimization — air-gapped boxes may not have sharp or a network CA
    unoptimized: true
  },
  swcMinify: true
};

module.exports = nextConfig;
