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
  /** 规范化频道名 → xmltv channel id，避免每个直播频道都全表扫描 */
  channelIdsByNormalizedName: Map<string, string>;
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
const EPG_CACHE_TTL = 10 * 60 * 1000;
const epgCache = new Map<string, { data: EpgData; expiresAt: number }>();

const CHANNEL_RE_SOURCE = '<channel\\s+id="([^"]+)"[^>]*>([\\s\\S]*?)<\\/channel>';
const PROGRAMME_RE_SOURCE =
  '<programme\\s+[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*channel="([^"]+)"[^>]*>([\\s\\S]*?)<\\/programme>';

type EpgAccumulator = Pick<
  EpgData,
  'programmesByChannel' | 'channelDisplayNames' | 'channelIdsByNormalizedName'
>;

const createAccumulator = (): EpgAccumulator => ({
  programmesByChannel: new Map<string, EpgProgramme[]>(),
  channelDisplayNames: new Map<string, string>(),
  channelIdsByNormalizedName: new Map<string, string>(),
});

const addChannelMatch = (target: EpgAccumulator, match: RegExpExecArray) => {
  const id = match[1];
  const displayName = match[2].match(/<display-name[^>]*>([^<]*)<\/display-name>/)?.[1]?.trim();
  if (!displayName) return;
  target.channelDisplayNames.set(id, displayName);
  const normalized = normalizeChannelName(displayName);
  if (normalized && !target.channelIdsByNormalizedName.has(normalized)) {
    target.channelIdsByNormalizedName.set(normalized, id);
  }
};

const addProgrammeMatch = (
  target: EpgAccumulator,
  match: RegExpExecArray,
  windowStart: number,
  windowEnd: number,
  wantedChannelIds?: Set<string>
) => {
  const channelId = match[3];
  if (wantedChannelIds && wantedChannelIds.size > 0 && !wantedChannelIds.has(channelId)) return;

  const start = parseXmltvTime(match[1]);
  const stop = parseXmltvTime(match[2]);
  if (!start || !stop || stop <= windowStart || start >= windowEnd) return;

  const title = match[4].match(/<title[^>]*>([^<]*)<\/title>/)?.[1]?.trim();
  if (!title) return;

  const entry: EpgProgramme = { channel: channelId, start, stop, title };
  const list = target.programmesByChannel.get(channelId);
  if (list) list.push(entry);
  else target.programmesByChannel.set(channelId, [entry]);
};

const finishEpgData = (target: EpgAccumulator, fetchedAt: number): EpgData => {
  for (const list of target.programmesByChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }
  return { ...target, fetchedAt };
};

/** 把执行权还给 RN 一帧，让播放器状态和遥控器事件可以继续被处理。 */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  const error = new Error('EPG 解析已中止');
  error.name = 'AbortError';
  throw error;
};

const buildEpgCacheKey = (epgUrl: string, wantedChannelIds?: Set<string>): string => {
  if (!wantedChannelIds || wantedChannelIds.size === 0) return epgUrl;
  return `${epgUrl}\n${[...wantedChannelIds].sort().join('\u0000')}`;
};

export const parseEpgXml = (
  xmlText: string,
  wantedChannelIds?: Set<string>,
  now: number = Date.now()
): EpgData => {
  const target = createAccumulator();

  // 1. 频道表：<channel id="x"> <display-name...>名称</display-name> </channel>
  const channelRe = new RegExp(CHANNEL_RE_SOURCE, 'g');
  let cm: RegExpExecArray | null;
  while ((cm = channelRe.exec(xmlText)) !== null) {
    addChannelMatch(target, cm);
  }

  // 2. 节目单：<programme start="..." stop="..." channel="x"> <title...>标题</title> </programme>
  //    保留过去 54 小时（配合 NAS 回看 48h 窗口，多留 6h 余量）到未来 24 小时的节目
  const windowStart = now - 54 * 60 * 60 * 1000;
  const windowEnd = now + 24 * 60 * 60 * 1000;
  const progRe = new RegExp(PROGRAMME_RE_SOURCE, 'g');
  let pm: RegExpExecArray | null;
  while ((pm = progRe.exec(xmlText)) !== null) {
    addProgrammeMatch(target, pm, windowStart, windowEnd, wantedChannelIds);
  }

  return finishEpgData(target, now);
};

/**
 * TV 运行时使用的协作式解析器。XMLTV 正则扫描仍在 JS 侧完成，但会定期让出
 * 事件循环，避免低性能电视在解析节目单时停止响应遥控器与播放器状态回调。
 */
export const parseEpgXmlAsync = async (
  xmlText: string,
  wantedChannelIds?: Set<string>,
  now: number = Date.now(),
  signal?: AbortSignal
): Promise<EpgData> => {
  throwIfAborted(signal);
  const target = createAccumulator();
  const channelRe = new RegExp(CHANNEL_RE_SOURCE, 'g');
  let cm: RegExpExecArray | null;
  let scanned = 0;
  while ((cm = channelRe.exec(xmlText)) !== null) {
    addChannelMatch(target, cm);
    if (++scanned % 100 === 0) {
      await yieldToUi();
      throwIfAborted(signal);
    }
  }

  // M3U 经常只有频道名而不是 XMLTV channel id。频道表已经解析完毕，先把
  // 名称候选换算成真正的 id，再过滤节目，减少后续保留对象和排序开销。
  let effectiveWantedIds = wantedChannelIds;
  if (wantedChannelIds && wantedChannelIds.size > 0) {
    // 原值本身可能就是 XMLTV id；同时补上按 display-name 命中的 id。
    effectiveWantedIds = new Set<string>(wantedChannelIds);
    for (const candidate of wantedChannelIds) {
      if (target.channelDisplayNames.has(candidate)) effectiveWantedIds.add(candidate);
      const matchedId = target.channelIdsByNormalizedName.get(normalizeChannelName(candidate));
      if (matchedId) effectiveWantedIds.add(matchedId);
    }
  }

  const windowStart = now - 54 * 60 * 60 * 1000;
  const windowEnd = now + 24 * 60 * 60 * 1000;
  const progRe = new RegExp(PROGRAMME_RE_SOURCE, 'g');
  let pm: RegExpExecArray | null;
  scanned = 0;
  while ((pm = progRe.exec(xmlText)) !== null) {
    addProgrammeMatch(target, pm, windowStart, windowEnd, effectiveWantedIds);
    if (++scanned % 250 === 0) {
      await yieldToUi();
      throwIfAborted(signal);
    }
  }

  throwIfAborted(signal);
  return finishEpgData(target, now);
};

export const fetchEpg = async (
  epgUrl: string,
  wantedChannelIds?: Set<string>,
  signal?: AbortSignal
): Promise<EpgData | null> => {
  if (signal?.aborted) return null;
  const cacheKey = buildEpgCacheKey(epgUrl, wantedChannelIds);
  const cached = epgCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.info('复用内存中的 EPG 索引');
    return cached.data;
  }
  if (cached) epgCache.delete(cacheKey);

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
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
      const data = await parseEpgXmlAsync(text, wantedChannelIds, Date.now(), controller.signal);
      logger.info(
        `EPG 解析完成：${data.programmesByChannel.size} 个频道有节目单，共 ${data.channelDisplayNames.size} 个频道名`
      );
      epgCache.set(cacheKey, { data, expiresAt: Date.now() + EPG_CACHE_TTL });
      // 电视端只需要最近几套源，限制缓存规模，避免多次改地址后常驻过多节目单。
      while (epgCache.size > 3) {
        const oldestKey = epgCache.keys().next().value;
        if (oldestKey === undefined) break;
        epgCache.delete(oldestKey);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (!controller.signal.aborted) logger.info('获取 EPG 失败:', error);
    return null;
  } finally {
    signal?.removeEventListener('abort', abortFromCaller);
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
  return epg.channelIdsByNormalizedName.get(target);
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
