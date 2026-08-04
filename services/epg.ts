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

/** 频道名规范化：合并常见清晰度/编码后缀及 CCTV 的全称、短名称变体。 */
export const normalizeChannelName = (name: string): string => {
  const compact = name
    .toLowerCase()
    .replace(/[（(][^）)]*(?:[）)]|$)/g, '')
    .replace(/(?:hevc|hdr|h265|h264|uhd|fhd|aac|ac3|4k|8k|hd|sd|高清|超清|标清|蓝光|无台标)/g, '')
    .replace(/[\s\-_.·]/g, '');

  // EPG 里同时存在“CCTV1 综合”和“CCTV-1”等别名，真正的节目数据经常只挂
  // 在短名称下面。数字频道统一为 cctv+编号，保留 CCTV5+ 的加号。
  const cctvNumber = compact.match(/^cctv(\d+\+?)/);
  if (cctvNumber) return cctvNumber[0];

  return compact.replace(/(?:频道|卫视)+$/g, '');
};

const MAX_EPG_BYTES = 40 * 1024 * 1024; // 超过 40MB 的 EPG 拒绝解析，避免卡死
const EPG_CACHE_TTL = 10 * 60 * 1000;
const EPG_DOWNLOAD_TIMEOUT = 10_000;
const epgCache = new Map<string, { data: EpgData; expiresAt: number }>();

// 最近一次 EPG 加载失败的原因：搬到电视屏幕上做诊断（盲调了三轮，需要真凭实据）
let epgLastError: string | null = null;
export const getEpgLastError = (): string | null => epgLastError;
const setEpgLastError = (error: unknown) => {
  if (!error) {
    epgLastError = null;
    return;
  }
  const err = error as { name?: string; message?: string };
  epgLastError = `${err?.name ?? 'Error'}: ${err?.message ?? String(error)}`.slice(0, 120);
};

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

/**
 * M3U 名称可能对应 XMLTV 里的多个别名。不能只取频道表中第一个别名，因为
 * 第一个常常只有 <channel> 定义，节目实际挂在另一个 id 下。
 */
const resolveWantedChannelIds = (
  target: EpgAccumulator,
  wantedChannelIds?: Set<string>
): Set<string> | undefined => {
  if (!wantedChannelIds || wantedChannelIds.size === 0) return wantedChannelIds;

  const resolved = new Set(wantedChannelIds);
  const normalizedWanted = new Set(
    [...wantedChannelIds].map(normalizeChannelName).filter(Boolean)
  );
  for (const [id, displayName] of target.channelDisplayNames) {
    if (
      normalizedWanted.has(normalizeChannelName(id)) ||
      normalizedWanted.has(normalizeChannelName(displayName))
    ) {
      resolved.add(id);
    }
  }
  return resolved;
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

  // 同名别名优先指向确实带节目数据的 id，避免命中“空壳”频道定义。
  for (const [id, displayName] of target.channelDisplayNames) {
    if (!target.programmesByChannel.has(id)) continue;
    const normalized = normalizeChannelName(displayName);
    if (normalized) target.channelIdsByNormalizedName.set(normalized, id);
  }
  // 某些 XMLTV 源的 programme channel 没有对应的 channel 定义，仍可按 id 匹配。
  for (const id of target.programmesByChannel.keys()) {
    const normalized = normalizeChannelName(id);
    if (normalized && !target.channelIdsByNormalizedName.has(normalized)) {
      target.channelIdsByNormalizedName.set(normalized, id);
    }
  }
  return { ...target, fetchedAt };
};

/**
 * 把执行权还给 RN 的 JS 事件循环，让播放器状态和遥控器事件优先被处理。
 *
 * 不能只等待 requestAnimationFrame：部分 Android TV 在原生视频画面播放时会
 * 暂停 JS 侧的帧回调，导致 EPG 解析永远卡在第一次让步，页面便会一直显示
 * “节目表尚未加载完成”。定时器不依赖画面刷新，电视息屏/视频播放时也会继续。
 */
const yieldToUi = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

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

  const effectiveWantedIds = resolveWantedChannelIds(target, wantedChannelIds);

  // 2. 节目单：<programme start="..." stop="..." channel="x"> <title...>标题</title> </programme>
  //    保留过去 54 小时（配合 NAS 回看 48h 窗口，多留 6h 余量）到未来 24 小时的节目
  const windowStart = now - 54 * 60 * 60 * 1000;
  const windowEnd = now + 24 * 60 * 60 * 1000;
  const progRe = new RegExp(PROGRAMME_RE_SOURCE, 'g');
  let pm: RegExpExecArray | null;
  while ((pm = progRe.exec(xmlText)) !== null) {
    addProgrammeMatch(target, pm, windowStart, windowEnd, effectiveWantedIds);
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
  let sliceStartedAt = Date.now();
  while ((cm = channelRe.exec(xmlText)) !== null) {
    addChannelMatch(target, cm);
    scanned++;
    if (Date.now() - sliceStartedAt >= 4 || scanned % 100 === 0) {
      await yieldToUi();
      throwIfAborted(signal);
      sliceStartedAt = Date.now();
    }
  }

  // 频道表解析完后一次性展开所有名称别名，再过滤节目对象。
  const effectiveWantedIds = resolveWantedChannelIds(target, wantedChannelIds);

  const windowStart = now - 54 * 60 * 60 * 1000;
  const windowEnd = now + 24 * 60 * 60 * 1000;
  const progRe = new RegExp(PROGRAMME_RE_SOURCE, 'g');
  let pm: RegExpExecArray | null;
  scanned = 0;
  sliceStartedAt = Date.now();
  while ((pm = progRe.exec(xmlText)) !== null) {
    addProgrammeMatch(target, pm, windowStart, windowEnd, effectiveWantedIds);
    scanned++;
    // 每个同步片段最多占用约 4ms；即使是性能较弱的电视盒子，也会在一帧内
    // 把执行权还给播放器和遥控事件。250 条为快速设备上的强制让步上限。
    if (Date.now() - sliceStartedAt >= 4 || scanned % 250 === 0) {
      await yieldToUi();
      throwIfAborted(signal);
      sliceStartedAt = Date.now();
    }
  }

  throwIfAborted(signal);
  return finishEpgData(target, now);
};

const downloadEpgWithFetch = async (epgUrl: string, signal: AbortSignal): Promise<string> => {
  const response = await fetch(epgUrl, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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
    // 网络下载需要超时保护，但本地解析不能共用这个计时器。
    // 注意：本机已验证纯 fetch 在该电视盒上可用（原生 blob-util 通道曾在
    // 此盒上引入"永不返回"的回归，勿再绕行原生下载器）。
    const timer = setTimeout(() => controller.abort(), EPG_DOWNLOAD_TIMEOUT);
    try {
      const text = await downloadEpgWithFetch(epgUrl, controller.signal);
      clearTimeout(timer);
      if (text.length > MAX_EPG_BYTES) {
        setEpgLastError(new Error(`文件过大 ${(text.length / 1024 / 1024).toFixed(1)}MB，超过 40MB 上限`));
        logger.info(`EPG 文件过大（${(text.length / 1024 / 1024).toFixed(1)}MB），放弃解析`);
        return null;
      }
      const data = await parseEpgXmlAsync(text, wantedChannelIds, Date.now(), controller.signal);
      logger.info(
        `EPG 解析完成：${data.programmesByChannel.size} 个频道有节目单，共 ${data.channelDisplayNames.size} 个频道名`
      );
      setEpgLastError(null);
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
    setEpgLastError(
      controller.signal.aborted ? new Error('AbortError: 下载超时(10s)或被中止') : error
    );
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
