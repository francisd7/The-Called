/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-only packages, left out of the webpack graph rather than bundled.
  // drizzle-orm is here for correctness and for a specific failure: once the
  // instrumentation hook's graph grows past webpack's split threshold, the
  // shared chunk is written to .next/server/chunks/ while the hook looks for it
  // in .next/server/, and the server dies at boot with MODULE_NOT_FOUND on a
  // file that is plainly there. Keeping the migrator out of the bundle keeps
  // the hook a single file, which is what it should have been all along.
  serverExternalPackages: ['postgres', 'drizzle-orm'],
};

export default nextConfig;
