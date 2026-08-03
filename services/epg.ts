/**
 * 极简 XMLTV (EPG) 获取与解析。
 *
 * XMLTV 文件常常有几十 MB，RN 里也没有 DOM，这里不做完整 XML 解析：
 * 用正则直接扫描 <channel> 与 <programme> 块，只保留「当前正在播或未来 24 小时」
 * 且属于目标频道的节目，内存与时间开销都可控。
 */
import Logger from '@/utils/Logger';

const logger = Logger.withTag('EPG');

export interface EpgProgramme {
  channel: string; // xmltv 里的 channel id
  start: number; // epoch ms
  stop: number; // epoch ms
  title: string;
}

export interface EpgData {
  /** xmltv channel id → 节目列表（按开始时间升序） */
  programmesByChannel: Map<string, EpgProgramme[]>;
  /** xmltv channel id → display-name（用于按名称兜底匹配） */
  channelDisplayNames: Map<string, string>;
  fetchedAt: number;
}

/** xmltv 时间格式："20260803200000 +0800"（时区可选）→ epoch ms */
export const parseXmltvTime = (raw: string): number => {
  const m = raw.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s, tz] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (tz) {
    const sign = tz[0] === '+' ? 1 : -1;
    const offMin = parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10);
    ms -= sign * offMin * 60_000;
  }
  return ms;
};

/** 频道名规范化：用于在 tvg-id 缺失时按名称兜底匹配 EPG */
export const normalizeChannelName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\s\-_]/g, '')
    .replace(/(高清|超清|hd|fhd|4k|8k|频道|卫视)+$/g, '');

const MAX_EPG_BYTES = 40 * 1024 * 1024; // 超过 40MB 的 EPG 拒绝解析，避免卡死

export const parseEpgXml = (
  xmlText: string,
  wantedChannelIds?: Set<string>,
  now: number = Date.now()
): EpgData => {
  const programmesByChannel = new Map<string, EpgProgramme[]>();
  const channelDisplayNames = new Map<string, string>();

  // 1. 频道表：<channel id="x"> <display-name...>名称</display-name> </channel>
  const channelRe = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g;
  let cm: RegExpExecArray | null;
  while ((cm = channelRe.exec(xmlText)) !== null) {
    const id = cm[1];
    const dn = cm[2].match(/<display-name[^>]*>([^<]*)<\/display-name>/);
    if (dn && dn[1]) {
      channelDisplayNames.set(id, dn[1].trim());
    }
  }

  // 2. 节目单：<programme start="..." stop="..." channel="x"> <title...>标题</title> </programme>
  //    只保留 stop > now - 1h 且 start < now + 24h 的，跳过历史与远期数据
  const windowStart = now - 1 * 60 * 60 * 1000;
  const windowEnd = now + 24 * 60 * 60 * 1000;
  const progRe =
    /<programme\s+[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g;
  let pm: RegExpExecArray | null;
  while ((pm = progRe.exec(xmlText)) !== null) {
    const channelId = pm[3];
    if (wantedChannelIds && wantedChannelIds.size > 0 && !wantedChannelIds.has(channelId)) {
      continue;
    }
    const start = parseXmltvTime(pm[1]);
    const stop = parseXmltvTime(pm[2]);
    if (!start || !stop || stop <= windowStart || start >= windowEnd) {
      continue;
    }
    const tm = pm[4].match(/<title[^>]*>([^<]*)<\/title>/);
    const title = tm && tm[1] ? tm[1].trim() : '';
    if (!title) continue;

    const list = programmesByChannel.get(channelId);
    const entry: EpgProgramme = { channel: channelId, start, stop, title };
    if (list) {
      list.push(entry);
    } else {
      programmesByChannel.set(channelId, [entry]);
    }
  }

  // 排序便于查找
  for (const list of programmesByChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return { programmesByChannel, channelDisplayNames, fetchedAt: now };
};

export const fetchEpg = async (epgUrl: string, wantedChannelIds?: Set<string>): Promise<EpgData | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(epgUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length > MAX_EPG_BYTES) {
        logger.info(`EPG 文件过大（${(text.length / 1024 / 1024).toFixed(1)}MB），放弃解析`);
        return null;
      }
      const data = parseEpgXml(text, wantedChannelIds);
      logger.info(
        `EPG 解析完成：${data.programmesByChannel.size} 个频道有节目单，共 ${data.channelDisplayNames.size} 个频道名`
      );
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    logger.info('获取 EPG 失败:', error);
    return null;
  }
};

/**
 * 查找频道当前正在播放的节目。
 * keys 按优先级给出：tvg-id、tvg-name、规范化后的频道名。
 */
export const getCurrentProgramme = (
  epg: EpgData,
  keys: (string | undefined)[],
  now: number = Date.now()
): EpgProgramme | null => {
  for (const key of keys) {
    if (!key) continue;
    const list = epg.programmesByChannel.get(key);
    if (!list) continue;
    for (const p of list) {
      if (p.start <= now && now < p.stop) return p;
      if (p.start > now) break; // 已按时间升序，后面都是未来节目
    }
  }
  return null;
};

/** 按 display-name 兜底找 xmltv channel id（频道名规范化后匹配） */
export const findEpgChannelIdByName = (epg: EpgData, channelName: string): string | undefined => {
  const target = normalizeChannelName(channelName);
  if (!target) return undefined;
  for (const [id, displayName] of epg.channelDisplayNames) {
    if (normalizeChannelName(displayName) === target) return id;
  }
  return undefined;
};

/** 频道 → 用于 EPG 匹配的候选 key 列表（含名称兜底解析） */
export const buildEpgKeys = (
  epg: EpgData,
  channel: { tvgId?: string; tvgName?: string; name: string }
): string[] => {
  const keys: string[] = [];
  if (channel.tvgId) keys.push(channel.tvgId);
  if (channel.tvgName) keys.push(channel.tvgName);
  const byName = findEpgChannelIdByName(epg, channel.name);
  if (byName) keys.push(byName);
  keys.push(channel.name); // 有些 EPG 直接用频道名做 id
  return keys;
};

export const formatProgrammeTime = (p: EpgProgramme): string => {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  return `${fmt(p.start)}-${fmt(p.stop)}`;
};
