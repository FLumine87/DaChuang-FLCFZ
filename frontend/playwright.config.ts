import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60000,
  use: {
    // localhost 兼容双栈：Vite 7 在某些环境只绑 IPv6 (::1)，写死 127.0.0.1 会 ERR_CONNECTION_REFUSED
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 1050 },
    launchOptions: {
      executablePath: process.env.AGENT_TEST_CHROME || (existsSync(edge) ? edge : undefined),
      // 无头环境没有真实摄像头：用假设备 + 自动允许权限，让 CameraCapture 的 e2e 可跑
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
});
