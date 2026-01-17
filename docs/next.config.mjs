import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  // Use trailing slashes to avoid conflicts with route handlers that have file extensions
  trailingSlash: true,
  // Note: rewrites are not supported with static export
  // The /llms.mdx route will be pre-rendered as static files
};

export default withMDX(config);
