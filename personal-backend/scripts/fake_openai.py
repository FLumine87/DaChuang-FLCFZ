#!/usr/bin/env python3
"""本地假的 OpenAI 兼容接口 —— 只用来验证链路，不产生任何真实智能。

为什么需要它：personal-backend 的 LLM 客户端走的是标准 OpenAI 协议
（POST {base}/chat/completions，SSE 在 choices[0].delta.content），
要验证"接入大模型后，流式输出 / 打字机效果 / 三元组抽取"是否真的能跑通，
就得有一个会按协议说话的端点。真实 Key 没有之前，用它来证明
**问题不在代码，只在 Key**。

实现的是够用的最小子集：
  · stream=false（抽取三元组用）→ 返回 {"choices":[{"message":{"content":...}}]}
    如果 system 提示里出现"信息抽取"，就回一个 JSON 数组（模拟抽到的三元组）
  · stream=true（陪伴对话用）→ 逐字发 SSE，最后 data: [DONE]

端口 8899。用法：
    python3 scripts/fake_openai.py
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8899

# 一段像样的中文回复，逐字吐出来（模拟大模型的流式输出）
REPLY = (
    "听起来这段时间你确实挺累的，睡不好又会反过来影响白天的状态，"
    "这种循环很磨人。你愿意说说最近是哪件事最占心思吗？"
)

# 模拟"三元组抽取"的结果（真实调用时由大模型生成）
TRIPLES = [
    {"relation": "SHOWS_SYMPTOM", "object": "失眠"},
    {"relation": "SHOWS_SYMPTOM", "object": "注意力下降"},
    {"relation": "EXPERIENCED_EMOTION", "object": "疲惫", "value": "4"},
]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 默认日志太吵
        pass

    def _json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            payload = {}

        messages = payload.get("messages") or []
        system = " ".join(str(m.get("content", "")) for m in messages if m.get("role") == "system")

        # 非流式：抽取三元组
        if not payload.get("stream"):
            if "信息抽取" in system or "三元组" in system:
                content = json.dumps(TRIPLES, ensure_ascii=False)
            else:
                content = REPLY
            return self._json({"choices": [{"message": {"role": "assistant", "content": content}}]})

        # 流式：逐字发 SSE
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def chunk_out(text: str) -> bytes:
            data = ("data: " + json.dumps(
                {"choices": [{"delta": {"content": text}}]}, ensure_ascii=False) + "\n\n").encode()
            return f"{len(data):X}\r\n".encode() + data + b"\r\n"

        for ch in REPLY:
            self.wfile.write(chunk_out(ch))
            self.wfile.flush()
            time.sleep(0.035)          # 模拟生成节奏，让打字机效果看得见
        done = b"data: [DONE]\n\n"
        self.wfile.write(f"{len(done):X}\r\n".encode() + done + b"\r\n")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


if __name__ == "__main__":
    print(f"假的 OpenAI 兼容接口已启动： http://127.0.0.1:{PORT}/v1")
    print("（仅用于验证链路；接真实大模型请改 personal-backend/.env 的 LLM_BASE_URL / LLM_API_KEY）")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
