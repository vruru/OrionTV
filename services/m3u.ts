import Logger from '@/utils/Logger';

const logger = Logger.withTag('M3U');

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo: string;
  group: string;
  /** EPG 匹配用：m3u 里的 tvg-id / tvg-name */
  tvgId?: string;
  tvgName?: string;
  /** 时移回看能力（来自 m3u 的 catchup 系列属性，仅部分源提供） */
  catchup?: string;
  catchupSource?: string;
  catchupDays?: string;
}

export const parseM3U = (m3uText: string): Channel[] => {
  const parsedChannels: Channel[] = [];
  const lines = m3uText.split('\n');
  let currentChannelInfo: Partial<Channel> | null = null;

  const matchAttr = (attrs: string, name: string): string | undefined => {
    const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return m && m[1] ? m[1] : undefined;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#EXTINF:')) {
      currentChannelInfo = {}; // Start a new channel
      const commaIndex = trimmedLine.lastIndexOf(',');
      if (commaIndex !== -1) {
        currentChannelInfo.name = trimmedLine.substring(commaIndex + 1).trim();
        const attributesPart = trimmedLine.substring(8, commaIndex);
        const logo = matchAttr(attributesPart, 'tvg-logo');
        if (logo) {
          currentChannelInfo.logo = logo;
        }
        const group = matchAttr(attributesPart, 'group-title');
        if (group) {
          currentChannelInfo.group = group;
        }
        currentChannelInfo.tvgId = matchAttr(attributesPart, 'tvg-id');
        currentChannelInfo.tvgName = matchAttr(attributesPart, 'tvg-name');
        currentChannelInfo.catchup = matchAttr(attributesPart, 'catchup');
        currentChannelInfo.catchupSource = matchAttr(attributesPart, 'catchup-source');
        currentChannelInfo.catchupDays = matchAttr(attributesPart, 'catchup-days');
      } else {
        currentChannelInfo.name = trimmedLine.substring(8).trim();
      }
    } else if (currentChannelInfo && trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('://')) {
      currentChannelInfo.url = trimmedLine;
      currentChannelInfo.id = currentChannelInfo.url; // Use URL as ID
      
      // Ensure all required fields are present, providing defaults if necessary
      const finalChannel: Channel = {
        id: currentChannelInfo.id,
        url: currentChannelInfo.url,
        name: currentChannelInfo.name || 'Unknown',
        logo: currentChannelInfo.logo || '',
        group: currentChannelInfo.group || 'Default',
        tvgId: currentChannelInfo.tvgId,
        tvgName: currentChannelInfo.tvgName,
        catchup: currentChannelInfo.catchup,
        catchupSource: currentChannelInfo.catchupSource,
        catchupDays: currentChannelInfo.catchupDays,
      };
      
      parsedChannels.push(finalChannel);
      currentChannelInfo = null; // Reset for the next channel
    }
  }
  return parsedChannels;
};

export const fetchAndParseM3u = async (m3uUrl: string): Promise<Channel[]> => {
  try {
    const response = await fetch(m3uUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch M3U: ${response.statusText}`);
    }
    const m3uText = await response.text();
    return parseM3U(m3uText);
  } catch (error) {
    logger.info("Error fetching or parsing M3U:", error);
    return []; // Return empty array on error
  }
};

export const getPlayableUrl = (originalUrl: string | null): string | null => {
  if (!originalUrl) {
    return null;
  }
  // In React Native, we use the proxy for all http streams to avoid potential issues.
  // if (originalUrl.toLowerCase().startsWith('http://')) {
  //   // Use the baseURL from the existing api instance.
  //   if (!api.baseURL) {
  //       console.warn("API base URL is not set. Cannot create proxy URL.")
  //       return originalUrl; // Fallback to original URL
  //   }
  //   return `${api.baseURL}/proxy?url=${encodeURIComponent(originalUrl)}`;
  // }
  // HTTPS streams can be played directly.
  return originalUrl;
};
