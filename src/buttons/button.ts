import { ButtonBuilder, ButtonStyle } from "discord.js";

export type ButtonData = { tag: string, originalUserId: string, metadata: string[], serialize: () => string }

export function createButtonData(tag: string, originalUserId: string, metadata: string[]): ButtonData {
    return {
        tag: tag,
        originalUserId: originalUserId,
        metadata: metadata,
        serialize() {
        return `${tag}:${originalUserId}:${metadata.join(':')}`
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
  return { tag, originalUserId, metadata, serialize: () => customId };
}
