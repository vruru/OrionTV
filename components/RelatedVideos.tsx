import React, { useEffect, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import VideoCard from "@/components/VideoCard";
import { api, SearchResult } from "@/services/api";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("RelatedVideos");

// 从 "张艺谋,李某某" / "张艺谋 / 李某某" 这类字段里取第一个名字
const firstNameOf = (raw?: string): string | null => {
  if (!raw) return null;
  const name = raw.split(/[,，、/|]/)[0]?.trim();
  return name || null;
};

interface RelatedVideosProps {
  /** 最小结构约定：detailStore 的 SearchResultWithResolution 与 VideoDetail 均兼容 */
  detail: {
    title: string;
    director?: string;
    actor?: string;
  };
}

/**
 * 详情页底部「相关推荐」：按导演（fallback 主演）搜索同作者作品。
 * 无导演/演员信息或搜索失败时整块不渲染，不影响主流程。
 */
export const RelatedVideos: React.FC<RelatedVideosProps> = ({ detail }) => {
  const [items, setItems] = useState<SearchResult[]>([]);

  useEffect(() => {
    const person = firstNameOf(detail.director) || firstNameOf(detail.actor);
    if (!person) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.searchVideos(person);
        if (cancelled) return;
        const filtered = res.results.filter((r) => r.title && r.title !== detail.title).slice(0, 10);
        setItems(filtered);
      } catch (error) {
        if (!cancelled) {
          logger.info("Related videos fetch failed:", error);
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.director, detail.actor, detail.title]);

  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <ThemedText style={styles.title}>相关推荐 · {firstNameOf(detail.director) || firstNameOf(detail.actor)}</ThemedText>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item, index) => `${item.source}-${item.id}-${index}`}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <VideoCard
              id={item.id.toString()}
              source={item.source}
              title={item.title}
              poster={item.poster}
              year={item.year}
              sourceName={item.source_name}
              api={api}
            />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  title: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  cardWrapper: {
    marginRight: 12,
  },
});

export default RelatedVideos;
