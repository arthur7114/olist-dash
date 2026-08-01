/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@oem/contracts"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
