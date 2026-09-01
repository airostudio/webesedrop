/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trend/core", "@trend/db"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
