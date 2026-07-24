import React from "react";
import { View, Text, StyleSheet, Modal, FlatList } from "react-native";
import { StyledButton } from "./StyledButton";
import useDetailStore, { SearchResultWithResolution } from "@/stores/detailStore";
import usePlayerStore from "@/stores/playerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSpeedTestStore } from "@/stores/speedTestStore";
import { filterHdSources, sortAndLimitBySpeed, formatSpeed, speedColor } from "@/utils/sourceFilter";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('SourceSelectionModal');

export const SourceSelectionModal: React.FC = () => {
  const { showSourceModal, setShowSourceModal, loadVideo, currentEpisodeIndex, status } = usePlayerStore();
  const { searchResults, detail, setDetail } = useDetailStore();
  const hdSourcesOnly = useSettingsStore((s) => s.hdSourcesOnly);
  const speedResults = useSpeedTestStore((s) => s.results);

  // Hide sub-1080p sources, then keep the fastest 5 by measured speed.
  const displaySources = sortAndLimitBySpeed(filterHdSources(searchResults, hdSourcesOnly), speedResults, 5);

  const onSelectSource = (item: SearchResultWithResolution) => {
    logger.debug("onSelectSource", item.source, detail?.source);
    if (item.source !== detail?.source) {
      const newDetail = item;
      setDetail(newDetail);

      // Reload the video with the new source, preserving current position
      const currentPosition = status?.isLoaded ? status.positionMillis : undefined;
      loadVideo({
        source: newDetail.source,
        id: newDetail.id.toString(),
        episodeIndex: currentEpisodeIndex,
        title: newDetail.title,
        position: currentPosition
      });
    }
    setShowSourceModal(false);
  };

  const onClose = () => {
    setShowSourceModal(false);
  };

  return (
    <Modal visible={showSourceModal} transparent={true} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>选择播放源</Text>
          <FlatList
            data={displaySources}
            numColumns={3}
            contentContainerStyle={styles.sourceList}
            keyExtractor={(item, index) => `source-${item.source}-${index}`}
            renderItem={({ item }) => {
              const spd = speedResults[item.source];
              return (
                <StyledButton
                  onPress={() => onSelectSource(item)}
                  isSelected={detail?.source === item.source}
                  hasTVPreferredFocus={detail?.source === item.source}
                  style={styles.sourceItem}
                >
                  <Text style={styles.sourceItemText} numberOfLines={1}>
                    {item.source_name}
                    {item.resolution ? ` · ${item.resolution}` : ""}
                    {spd ? <Text style={{ color: speedColor(spd.mbps) }}>{` (${formatSpeed(spd.mbps)})`}</Text> : ""}
                  </Text>
                </StyledButton>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  modalContent: {
    width: 600,
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    padding: 20,
  },
  modalTitle: {
    color: "white",
    marginBottom: 12,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  sourceList: {
    justifyContent: "flex-start",
  },
  sourceItem: {
    paddingVertical: 2,
    margin: 4,
    marginLeft: 10,
    marginRight: 8,
    width: "30%",
  },
  sourceItemText: {
    fontSize: 14,
  },
});
