import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置。
 * - androidScheme: 'https' → WebView 页面运行在 https://localhost，
 *   是「安全上下文」，getUserMedia（麦克风）等 API 才可用。
 * - webDir: 'dist' → `npm run build` 的产物，`cap sync` 会同步进 android 工程。
 */
const config: CapacitorConfig = {
  appId: 'com.dachuang.psychscreen',
  appName: '心理守护',
  webDir: 'dist',
  android: {
    // 实机模式要访问 http 后端时可放开；默认只走 https
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#059669',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
