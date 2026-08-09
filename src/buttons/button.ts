import { ButtonBuilder, ButtonStyle } from "discord.js";
import {
  decodeLegacySeriesData,
  decodeSeriesData,
  encodeSeriesData,
  encodeSnowflake,
  decodeSnowflake,
  SeriesData,
} from "../types/toddData";

export type ButtonData = { tag: string, originalUserId: string, seriesData: SeriesData, serialize: () => string }

/** Discord rejects any component whose custom_id is longer than this. */
export const MAX_CUSTOM_ID_LENGTH = 100;

/**
 * Marks the base36 layout. Legacy ids put the originalUserId snowflake here,
 * which is digits only, so the two can never be confused.
 */
const VERSION = 'v1';

/**
 * Wire codes for the tags `getButtonHandler` routes.
 *
 * The tag was the single largest field in the id - `generate_another_confirm`
 * alone was 24 of the 100 characters, spent on a value with only thirteen
 * possibilities. Codes go on the wire; the readable name is what handlers
 * switch on and what gets logged, because `parseButtonData` maps back before
 * anyone sees it. Adding a tag means adding it here.
 *
 * These codes are load-bearing once a button is in a Discord message. Add
 * freely, but do not repurpose an existing code - it would reroute buttons that
 * are already sitting in channels.
 */
const TAG_CODES: Record<string, string> = {
  division_select: 'd',
  team1_select: '1',
  team2_select: '2',
  stage_select: 's',
  series_select: 'ss',
  confirm: 'c',
  switch: 'w',
  switch_sides: 'ws',
  cancel: 'x',
  cancel_flow: 'xf',
  cancel_switch: 'xw',
  generate_another: 'g',
  generate_another_confirm: 'gc',
  // Retired rather than removed, so a new tag cannot inherit the code. Dennys
  // closes a series on result write; nothing in Todd ends one.
  end_series: 'e',
};

const TAG_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_CODES).map(([name, code]) => [code, name]),
);

/**
 * The budget check below is sized against the longest code rather than the tag
 * being written right now, because tags grow as a series moves along: `s`
 * (stage_select) is 1 character and `gc` (generate_another_confirm) is 2.
 * Sizing against the current tag would let a series pass selection and only
 * fail a character later, at the Confirm button that gets built *after* the
 * game has already been created in dennys.
 */
const LONGEST_TAG_LENGTH = Math.max(...Object.values(TAG_CODES).map((c) => c.length));

export class CustomIdTooLongError extends Error {
  constructor(readonly customId: string) {
    super(
      `custom_id is ${customId.length} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH} limit: ${customId}`,
    );
    this.name = 'CustomIdTooLongError';
  }
}

function serializeButtonData(tag: string, originalUserId: string, seriesData: SeriesData): string {
  const parts = encodeSeriesData(seriesData);
  // An unregistered tag rides along verbatim rather than throwing. It still
  // routes (parseButtonData hands back whatever it can't map), it just spends
  // the characters - and the length check below is what catches it if that
  // spending matters.
  const code = TAG_CODES[tag] ?? tag;
  return `${code}:${VERSION}:${encodeSnowflake(originalUserId)}:${parts.join(':')}`;
}

/**
 * Sized against a series id well past anything dennys issues today, for the same
 * reason the tag is sized against the longest code: the check runs while the
 * series is still unresolved, and the id is pinned later, onto the button built
 * after the code already exists.
 */
const WORST_CASE_SERIES_ID = 9999999;

/**
 * True when this series still fits once it reaches the longest-tagged button in
 * the flow. Call it before doing anything irreversible - the stage name comes
 * from dennys as a free-form string, so it is the field that can push an
 * otherwise ordinary series over the cap.
 */
export function seriesDataFits(originalUserId: string, seriesData: SeriesData): boolean {
  const worstCase = serializeButtonData('x'.repeat(LONGEST_TAG_LENGTH), originalUserId, {
    ...seriesData,
    seriesId: WORST_CASE_SERIES_ID,
  });
  return worstCase.length <= MAX_CUSTOM_ID_LENGTH;
}

export function createButtonData(tag: string, originalUserId: string, seriesData: SeriesData): ButtonData {
  return {
    tag,
    originalUserId,
    seriesData,
    serialize() {
      const customId = serializeButtonData(this.tag, this.originalUserId, this.seriesData);
      // Fail here rather than inside discord.js, where this surfaces as a bare
      // "Invalid Form Body" with no clue which field was the long one.
      if (customId.length > MAX_CUSTOM_ID_LENGTH) throw new CustomIdTooLongError(customId);
      return customId;
    },
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
  // Legacy ids carry the full name, which is never also a code, so the fallback
  // covers them. Everything downstream - handlers.ts, the collector filters,
  // the logs - only ever sees the readable name.
  const tag = TAG_NAMES[parts[0]] ?? parts[0];
  const isVersioned = parts[1] === VERSION;
  const originalUserId = isVersioned ? decodeSnowflake(parts[2]) : (parts[1] ?? '');
  const metadata = parts.slice(isVersioned ? 3 : 2);
  // The stage is last precisely so it can absorb the rest of the split. A stage
  // named "Week 1: Opener" used to shift every field after it; now it survives.
  // Legacy ids carry one field fewer, so its position differs.
  const stageIndex = isVersioned ? 5 : 4;
  const fields = [...metadata.slice(0, stageIndex), metadata.slice(stageIndex).join(':')];
  return {
    tag,
    originalUserId,
    seriesData: isVersioned ? decodeSeriesData(fields) : decodeLegacySeriesData(fields),
    serialize: () => customId,
  };
}
