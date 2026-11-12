/*
 * 检索与分析偏好（本机设置）
 * ========================
 * 设置页写入，检索页读取。两项都只影响当前浏览器，
 * 不上传后端，也不随账号同步。
 */

const INCLUDE_ORIGINAL_KEY = 'psych_retrieval_include_original';
const SAVE_TO_SYSTEM_KEY = 'psych_retrieval_save_to_system';

/** 报告是否结合本次原始文字输入分析（默认开启） */
export function readIncludeOriginalInput(): boolean {
  return localStorage.getItem(INCLUDE_ORIGINAL_KEY) !== 'false';
}

export function writeIncludeOriginalInput(enabled: boolean): void {
  localStorage.setItem(INCLUDE_ORIGINAL_KEY, String(enabled));
}

/** 检索是否作为一条记录送入系统（默认开启） */
export function readSaveToSystem(): boolean {
  return localStorage.getItem(SAVE_TO_SYSTEM_KEY) !== 'false';
}

export function writeSaveToSystem(enabled: boolean): void {
  localStorage.setItem(SAVE_TO_SYSTEM_KEY, String(enabled));
}
