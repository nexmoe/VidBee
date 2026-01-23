import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // Only use static export for production builds, not dev mode
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  reactStrictMode: true,
  // Use trailing slashes to avoid conflicts with route handlers that have file extensions
  trailingSlash: true,
  images: {
    // Required for Next.js static export to avoid broken images.
    unoptimized: true,
  },
  // Note: rewrites are not supported with static export
  // The /llms.mdx route will be pre-rendered as static files
};

export default withMDX(config);
