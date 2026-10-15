package com.dachuang.psychscreen;

import android.os.Bundle;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

/**
 * App 入口：先把主后端在设备本机拉起来，再交给 Capacitor 加载前端。
 *
 * 为什么在 App 里跑后端：
 *   作品的卖点是"跨模态哈希检索"这类真实计算。此前离线版只能返回内置样例，
 *   演示时被问"这是真算的吗"没法回答。把后端（纯 Python + numpy + Pillow）
 *   用 Chaquopy 打进 APK 之后，检索确实在这台手机上跑 —— 且不需要任何服务器。
 *
 * 为什么要开线程：
 *   run_server 内部是 serve_forever()，会一直阻塞。放在主线程会让 App 直接卡死
 *   （黑屏、ANR），所以丢到后台守护线程。
 *
 * 为什么先 start 再 super.onCreate：
 *   让服务尽早开始初始化；即使它慢一点，也不影响 WebView 的加载 ——
 *   前端那边的请求在服务没起来之前会失败，但 api 层已经做了本机降级，
 *   页面不会白屏，等服务就绪后刷新即可。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PsychScreen";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        startBackend();
        super.onCreate(savedInstanceState);
    }

    /** 在后台线程拉起本机后端；失败只记日志，不阻断 App 启动。 */
    private void startBackend() {
        try {
            if (!Python.isStarted()) {
                Python.start(new AndroidPlatform(getApplicationContext()));
            }
            final Python py = Python.getInstance();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        PyObject mod = py.getModule("start_server");
                        String smoke = mod.callAttr("smoke").toString();
                        Log.i(TAG, "后端冒烟: " + smoke);
                        String r = mod.callAttr("start_background", 8000).toString();
                        Log.i(TAG, "后端启动: " + r);
                    } catch (Throwable t) {
                        Log.e(TAG, "后端启动失败", t);
                    }
                }
            }, "psych-backend").start();
        } catch (Throwable t) {
            Log.e(TAG, "Python 初始化失败", t);
        }
    }
}
