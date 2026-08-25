/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Server-only dependencies. Bundling them pulls them into the /_document path,
  // where Next 15.1 then fails to emit their vendor chunk.
  // xlsx is used server-side (the Excel export route) via Node require, and
  // client-side (the in-grid export) via the bundler.
  serverExternalPackages: ["pg", "yaml", "xlsx"],
  // Same failure mode, but lucide-react is client-side so it has to be transpiled
  // rather than externalised.
  transpilePackages: ["lucide-react"],
  // SheetJS (xlsx) lazily references Node built-ins behind runtime guards; in the
  // browser bundle it only needs the download path, so stub these out.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
};
export default nextConfig;
