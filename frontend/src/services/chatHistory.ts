/**
 * chatHistory.ts · AI 陪伴对话的「本机聊天记录」持久化（L1 方案）
 *
 * 为什么需要：
 *   ChatPage 原先把消息放在 React state 里，离开页面（切路由 / 刷新 / 重进）
 *   组件卸载，`messages` 直接回到只剩一句欢迎语——用户回到该页面，聊天记录全没了。
 *   后端也只有对话**生成**能力（/chat/companion），没有任何持久化，请求-响应完即止。
 *
 * 存在哪：localStorage，键 `psych_chat:v1:<username>`，与既有的
 *   `psych_kg:v1:<username>`（对话抽取出的三元组）分开、互不影响。
 *   清空聊天记录只动这个键，**不会**动知识图谱与量表记录。
 *
 * 为什么是本机而不是服务端：
 *   8001 现已加鉴权（2026-11-08，见 personal-backend/app/core/auth.py），
 *   聊天原文落到服务端不再是"任何人凭 user_id 就能读走"。
 *   但仍保持本机存储，理由变为：
 *     · 本机存留离线可用，后端没起也能翻看历史对话；
 *     · 聊天原文是最敏感的一类数据，能不上传就不上传是更稳妥的默认。
 *   代价：换浏览器 / 清缓存即丢失。
 *
 * 只存不编：
 *   这里只做「用户自己说过的话 + 助手确实回过的内容」的搬运，不生成任何文案。
 *   离线兜底回复（offline）与演示模式标注（replyMock）一并保留，刷新后如实还原，
 *   不会把兜底文案伪装成大模型回复。
 */

import type { ExtractResult } from './api';

/** 与 ChatPage 的 ChatMessage 同结构；单独定义一份，避免服务层反向依赖页面组件 */
export interface StoredChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /**
   * 这条消息产生的时间（ISO 字符串）。用于对话里的时间节点。
   *
   * 为什么用 ISO 而不是时间戳：与本项目其它持久化（LocalTriple.at、
   * LocalKgStore.updatedAt）保持同一格式，读日志时人眼也能直接看懂。
   * 老记录（本次改动之前写的）没有这个字段 —— 此时**不猜时间**，
   * 界面上就不显示时间分隔，而不是拿"打开页面的时刻"冒充历史时间。
   */
  at?: string;
  extract?: ExtractResult;
  /** 这条回应是本机规则给的（后端不可达），界面上标注「离线模式」 */
  offline?: boolean;
  /** 对话服务端处于演示模式（未配 LLM 或 Mock），回复来自本机文案 */
  replyMock?: boolean;
}

export interface ChatHistoryStore {
  messages: StoredChatMessage[];
  updatedAt: string;
}

const KEY_PREFIX = 'psych_chat:v1:';

/** 只保留最近的消息条数：localStorage 有配额，长聊不该无限堆积 */
const MAX_MESSAGES = 300;

export function chatHistoryKey(username: string): string {
  return `${KEY_PREFIX}${username || 'demo_user'}`;
}

/**
 * 读取本机聊天记录。
 * 读不到（首次 / 隐私模式 / 数据损坏）一律返回空数组，由调用方决定是否放欢迎语，
 * 不在这里造任何默认消息。
 */
export function readChatHistory(username: string): StoredChatMessage[] {
  try {
    const raw = localStorage.getItem(chatHistoryKey(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatHistoryStore;
    const list = Array.isArray(parsed?.messages) ? parsed.messages : [];
    return list.filter(
      (m): m is StoredChatMessage =>
        Boolean(m) &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.id === 'number' &&
        typeof m.text === 'string',
    );
  } catch {
    /* 隐私模式或数据损坏：当作"本机还没有聊天记录"，不阻断页面 */
    return [];
  }
}

/**
 * 覆盖写入本机聊天记录。
 *
 * 写入前两道过滤，都是为了避免把"半成品"存进去：
 *   1. 丢掉 text 为空的消息 —— 流式回复的占位气泡在拿到第一个字之前 text 是 ''，
 *      用户中途离开页面时不该把空泡泡留在历史里；
 *   2. 只留最近 MAX_MESSAGES 条 —— 超长会话按最旧的丢弃。
 *
 * 写入失败（配额满 / 隐私模式）不抛错：本次会话仍可正常聊天，只是刷新后会丢，
 * 页面另有「本机聊天记录」说明。
 */
export function saveChatHistory(username: string, messages: StoredChatMessage[]): void {
  const clean = messages.filter((m) => m.text.trim() !== '');
  const trimmed = clean.length > MAX_MESSAGES ? clean.slice(-MAX_MESSAGES) : clean;
  const next: ChatHistoryStore = { messages: trimmed, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(chatHistoryKey(username), JSON.stringify(next));
  } catch {
    /* 写不进去也不报错 */
  }
}

/**
 * 清空本机聊天记录。
 * 只删 `psych_chat:v1:<username>` 这一个键 —— 知识图谱三元组（psych_kg:v1:*）
 * 与量表记录完全不受影响。
 */
export function clearChatHistory(username: string): void {
  try {
    localStorage.removeItem(chatHistoryKey(username));
  } catch {
    /* 忽略 */
  }
}
