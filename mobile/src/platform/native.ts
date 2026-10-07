/**
 * native.ts — Capacitor 原生能力封装
 *
 * 全部做了「非原生环境降级」：在浏览器里跑 `npm run dev` 时不会报错，
 * 摄像头自动退回 <input type="file">，返回键逻辑直接忽略。
 */

import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platformName = (): string => Capacitor.getPlatform();

/** 初始化状态栏样式（幂等，可重复调用） */
export async function initNative(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Light });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#059669' });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch {
    /* 状态栏插件不可用时忽略 */
  }
}

/**
 * 注册 Android 物理返回键监听，**返回注销函数**。
 *
 * ⚠️ 必须注销：`useBackHandler` 随路由变化重跑，若只 add 不 remove，
 * 监听器会随每次导航累积 → 按一次返回键触发多次回退（表现为"一次退好多层"）。
 */
export async function registerBackHandler(onBack: () => boolean): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const handle = await CapApp.addListener('backButton', () => {
      // onBack 返回 true 表示「已处理」（在子页面里返回上一层）；
      // 返回 false 表示已在根页面 → 交还系统（退出 App）
      const handled = onBack();
      if (!handled) void CapApp.exitApp();
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

export interface PickedImage {
  base64: string;
  dataUrl: string;
  name: string;
}

/**
 * 拍照 / 从相册选图，返回 base64（不含 data URL 前缀）与可直接 <img> 的 dataUrl。
 * 非原生环境返回 null，由调用方退回 <input type="file">。
 */
export async function pickImage(): Promise<PickedImage | null> {
  if (!isNative()) return null;
  try {
    const photo = await Camera.getPhoto({
      quality: 82,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      promptLabelHeader: '多模态采集',
      promptLabelPhoto: '从相册选择',
      promptLabelPicture: '拍照',
      promptLabelCancel: '取消',
    });
    if (!photo.base64String) return null;
    const format = photo.format || 'jpeg';
    return {
      base64: photo.base64String,
      dataUrl: `data:image/${format};base64,${photo.base64String}`,
      name: `capture_${Date.now()}.${format}`,
    };
  } catch {
    // 用户取消也会走到这里
    return null;
  }
}

/** 轻震动反馈（原生才有；浏览器里静默） */
export async function tapFeedback(): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* 无马达设备忽略 */
  }
}

/** 把 base64 转成 File，供共享的 uploadFile / search 使用 */
export function base64ToFile(base64: string, name: string, mime: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/** File → 纯 base64（后端检索接口不接受 data URL 前缀） */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const comma = raw.indexOf(',');
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.onerror = () => reject(new Error('文件读取失败，请重试'));
    reader.readAsDataURL(file);
  });
}
