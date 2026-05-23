/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  webpack(webpackConfig) {
    // Stub optional peer deps from wagmi connectors that are not installed
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      // wagmi v3 connectors (kept for completeness)
      "porto/internal": false,
      "@base-org/account": false,
      "@metamask/connect-evm": false,
      "@safe-global/safe-apps-sdk": false,
      "@safe-global/safe-apps-provider": false,
      // wagmi v2 connectors optional deps
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return webpackConfig;
  },
};
export default config;
