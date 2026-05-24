/** @type {import('next').NextConfig} */
const nextConfig = {
  // @themis/shared and @themis/hl-client ship TypeScript source (their package
  // `exports` point at .ts files), so Next must transpile them rather than
  // treat them as pre-built node_modules.
  transpilePackages: ["@themis/shared", "@themis/hl-client"],
};

module.exports = nextConfig;
