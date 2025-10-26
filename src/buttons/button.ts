import { ButtonBuilder, ButtonStyle } from "discord.js";
import { decodeSeriesData, encodeSeriesData, SeriesData } from "../types/toddData";

export type ButtonData = { tag: string, originalUserId: string, seriesData: SeriesData, serialize: () => string }

export function createButtonData(tag: string, originalUserId: string, seriesData: SeriesData): ButtonData {
    return {
        tag: tag,
        originalUserId: originalUserId,
        seriesData: seriesData,
        serialize() {
          const parts = encodeSeriesData(this.seriesData);
        return `${tag}:${originalUserId}:${parts.join(':')}`;
    }
  };
}

export function createButton(data: ButtonData, label: string, style: ButtonStyle, emoji: string ): ButtonBuilder {
  return new ButtonBuilder()
      .setCustomId(data.serialize())
      .setLabel(label)
      .setStyle(style)
      .setEmoji(emoji);
}
export function parseButtonData(customId: string): ButtonData {
  const parts = customId.split(':');
  const tag = parts[0];
  const originalUserId = parts[1];
  const metadata = parts.slice(2);
  return { tag, originalUserId, seriesData: decodeSeriesData(metadata), serialize: () => customId };
}
