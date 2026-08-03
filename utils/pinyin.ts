/**
 * 直播频道搜索的拼音匹配工具。
 *
 * TV 端遥控器输入中文不方便，搜索主要输入英文/拼音首字母：
 *   "bj" / "bjws" → 北京卫视，"cctv" → CCTV-1
 * 基于 pinyin-pro 提取首字母；频道名集合固定，结果做缓存。
 */
import { pinyin } from "pinyin-pro";

const firstLetterCache = new Map<string, string>();

/** 提取文本的拼音首字母串（小写、去空白）；非汉字保留原字符（小写） */
export const getFirstLetters = (text: string): string => {
  const cached = firstLetterCache.get(text);
  if (cached !== undefined) return cached;

  let result: string;
  try {
    // pattern: 'first' 只取首字母；非中文字符 pinyin-pro 原样返回
    result = pinyin(text, { pattern: "first", toneType: "none", type: "string" })
      .toLowerCase()
      .replace(/\s+/g, "");
  } catch {
    result = text.toLowerCase().replace(/\s+/g, "");
  }

  // 缓存上限保护：频道名量级几百，正常远达不到
  if (firstLetterCache.size > 5000) firstLetterCache.clear();
  firstLetterCache.set(text, result);
  return result;
};

/**
 * 频道名是否命中搜索关键词：
 * 1. 名称原文包含（不区分大小写）
 * 2. 拼音首字母串包含（"bjws" 命中 "北京卫视"）
 * 3. 全拼串包含（"beijing" 命中 "北京卫视"；仅 >=3 字符的关键词启用，
 *    避免 "sh" 这类短词跨字边界误命中 "weiSHi"）
 */
export const matchChannelSearch = (channelName: string, keyword: string): boolean => {
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, "");
  if (!kw) return true;
  const name = channelName.toLowerCase();
  if (name.includes(kw)) return true;
  if (getFirstLetters(channelName).includes(kw)) return true;
  if (kw.length >= 3) {
    try {
      const full = pinyin(channelName, { toneType: "none", type: "string" })
        .toLowerCase()
        .replace(/\s+/g, "");
      if (full.includes(kw)) return true;
    } catch {
      // pinyin 失败时退化为名称匹配结果
    }
  }
  return false;
};
