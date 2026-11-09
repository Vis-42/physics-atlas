/** @type {import('next').NextConfig} */
// BASE_PATH lets the same build live in a sub-folder, e.g. a GitHub Pages project site (/physics-atlas).
const base = process.env.BASE_PATH || '';
const nextConfig = {
  output: 'export',
  basePath: base,
  assetPrefix: base || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: base },
  images: { unoptimized: true },
  reactStrictMode: false,
};
export default nextConfig;
