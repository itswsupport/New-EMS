/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Server-only dependencies. Bundling them pulls them into the /_document path,
  // where Next 15.1 then fails to emit their vendor chunk.
  serverExternalPackages: ["pg", "yaml"],
  // Same failure mode, but lucide-react is client-side so it has to be transpiled
  // rather than externalised.
  transpilePackages: ["lucide-react"],
};
export default nextConfig;
