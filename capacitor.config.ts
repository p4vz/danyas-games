import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.danyasgames.app",
  appName: "Danya's Games",
  webDir: "dist",
  backgroundColor: "#0e0e16",
  android: {
    // Keep the WebView lean for low-end devices.
    allowMixedContent: false,
  },
};

export default config;
