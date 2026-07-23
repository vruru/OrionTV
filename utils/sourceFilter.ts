// Helpers for filtering play sources by resolution.

/**
 * Parse a resolution label (e.g. "1080p", "2160p", "720p", "4K") into a numeric
 * height in pixels. Returns null when the resolution is unknown/unparseable.
 */
export const parseResolutionHeight = (resolution?: string | null): number | null => {
  if (!resolution) return null;
  if (/4k/i.test(resolution)) return 2160;
  if (/2k/i.test(resolution)) return 1440;
  const match = resolution.match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * When hdOnly is enabled, hide sources whose detected resolution is known and
 * below 1080p. Sources with unknown resolution are kept (detection may still be
 * running or unsupported for that stream). If filtering would remove every
 * source, the original list is returned so playback is never impossible.
 */
export const filterHdSources = <T extends { resolution?: string | null }>(
  sources: T[],
  hdOnly: boolean
): T[] => {
  if (!hdOnly) return sources;
  const filtered = sources.filter((s) => {
    const height = parseResolutionHeight(s.resolution);
    return height === null || height >= 1080;
  });
  return filtered.length > 0 ? filtered : sources;
};
