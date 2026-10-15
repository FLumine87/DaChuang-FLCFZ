package com.dachuang.psychscreen;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.lang.reflect.Method;

/**
 * App 入口。如果这个包带了 Chaquopy（后端跑在手机里），就先把后端起起来。
 *
 * 为什么全用反射、不直接 import com.chaquo.python.*：
 *   同一个安卓工程要出三种包 —— 离线版 / 连后端版 / Chaquopy 版。
 *   Chaquopy 只在 Chaquopy 版启用（Gradle 属性 -Pchaquopy 控制）。
 *   如果这里直接 import，另外两个包里没有这些类，**编译期就过不去**
 *   （实测报 "package com.chaquo.python does not exist"）。
 *   反射让这份代码在三种包里都能编过：带了 Chaquopy 就找到类、正常启动后端；
 *   没带就 ClassNotFoundException，安静跳过 —— 那两种包本来也不需要本机后端。
 *
 * 为什么开线程：
 *   后端的 run_server 内部是 serve_forever()，会一直阻塞，放主线程直接 ANR。
 *
 * 为什么先 start 再 super.onCreate：
 *   让它尽早开始初始化；即使慢，也不挡 WebView 加载 ——
 *   前端的 api 层已有本机降级，服务没起来时页面不会白屏。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PsychScreen";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        startBackendIfPresent();
        super.onCreate(savedInstanceState);
    }

    private void startBackendIfPresent() {
        try {
            final Class<?> pythonCls = Class.forName("com.chaquo.python.Python");
            final Class<?> platformCls = Class.forName("com.chaquo.python.android.AndroidPlatform");

            // Python.start(new AndroidPlatform(context)) —— 只能启动一次
            Object isStarted = pythonCls.getMethod("isStarted").invoke(null);
            if (!Boolean.TRUE.equals(isStarted)) {
                Object platform = platformCls.getConstructor(android.content.Context.class)
                        .newInstance(getApplicationContext());
                pythonCls.getMethod("start", platformCls).invoke(null, platform);
            }
            final Object py = pythonCls.getMethod("getInstance").invoke(null);
            final Method getModule = pythonCls.getMethod("getModule", String.class);

            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Object mod = getModule.invoke(py, "start_server");
                        Method smoke = mod.getClass().getMethod("callAttr", String.class);
                        Object smokeOut = smoke.invoke(mod, "smoke");
                        Log.i(TAG, "后端自检: " + String.valueOf(smokeOut));
                        Object started = mod.getClass()
                                .getMethod("callAttr", String.class, Object[].class)
                                .invoke(mod, "start_background", new Object[]{new Object[]{8000}});
                        Log.i(TAG, "后端启动: " + String.valueOf(started));
                    } catch (Throwable t) {
                        Log.e(TAG, "后端线程异常", t);
                    }
                }
            }, "psych-backend").start();

            Log.i(TAG, "检测到 Chaquopy，已请求启动本机后端");
        } catch (ClassNotFoundException e) {
            // 正常情况：离线版 / 连后端版没有 Chaquopy
            Log.i(TAG, "本包未包含 Chaquopy，跳过本机后端");
        } catch (Throwable t) {
            Log.e(TAG, "启动本机后端失败（不影响 App 使用）", t);
        }
    }
}
