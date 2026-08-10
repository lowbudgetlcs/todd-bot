import { ButtonBuilder, ButtonStyle } from "discord.js";
import {
  decodeLegacySeriesData,
  decodeSeriesData,
  encodeSeriesData,
  encodeSnowflake,
  decodeSnowflake,
  SeriesData,
} from "../types/toddData";

export type ButtonData = {
  tag: string,
  /**
   * Small integers the handler needs that are not part of the series: which
   * tournament code this button reports, and which game number the thread shows
   * for it. Rides inside the tag field rather than as a field of its own,
   * because `stage` is deliberately last and absorbs every remaining colon -
   * adding a field would shift `stageIndex` and misparse every button already
   * sitting in a Discord message.
   *
   * A shortcode would not fit. Riot's are long enough to push an ordinary series
   * past the 100-character cap on their own, which is why this carries the
   * code's id instead and lets dennys resolve it.
   */
  tagArg?: string,
  originalUserId: string,
  seriesData: SeriesData,
  serialize: () => string,
}

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
  // Same handler as generate_another_confirm, deliberately a separate tag: only
  // this one means "the code I have is dead", which is what licenses replacing
  // its message. Pressing Generate Next Game before reporting also produces a
  // code for the same game number, and must not.
  regenerate_confirm: 'rc',
  report_result: 'r',
  // Same handler as report_result, deliberately a separate tag: a custom is
  // played outside Riot, so dennys has no record of it and never will. Only
  // this tag skips the "has Riot already reported this?" check, which would
  // otherwise read the previous game's result and refuse the report.
  report_custom: 'rk',
  report_team1_won: 'r1',
  report_team2_won: 'r2',
  code_not_working: 'cn',
  play_custom: 'pc',
  play_custom_confirm: 'pk',
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

/**
 * Separates the tag from its argument. A dot rather than a colon, so the tag
 * field stays one `split(':')` part and every existing index holds.
 */
const TAG_ARG_SEPARATOR = '.';

function serializeButtonData(
  tag: string,
  originalUserId: string,
  seriesData: SeriesData,
  tagArg?: string,
): string {
  const parts = encodeSeriesData(seriesData);
  // An unregistered tag rides along verbatim rather than throwing. It still
  // routes (parseButtonData hands back whatever it can't map), it just spends
  // the characters - and the length check below is what catches it if that
  // spending matters.
  const code = TAG_CODES[tag] ?? tag;
  const head = tagArg ? `${code}${TAG_ARG_SEPARATOR}${tagArg}` : code;
  return `${head}:${VERSION}:${encodeSnowflake(originalUserId)}:${parts.join(':')}`;
}

/**
 * Sized against a series id well past anything dennys issues today, for the same
 * reason the tag is sized against the longest code: the check runs while the
 * series is still unresolved, and the id is pinned later, onto the button built
 * after the code already exists.
 */
const WORST_CASE_SERIES_ID = 9999999;

/**
 * Sized the same way as the tag and the series id: a code id and a game number,
 * both far past anything dennys will issue. The report buttons that carry one
 * are built long after `seriesDataFits` runs, so the budget has to be reserved
 * up front or a late button is the first to discover it does not fit.
 */
const WORST_CASE_TAG_ARG = '9999999-99';

/**
 * True when this series still fits once it reaches the longest-tagged button in
 * the flow. Call it before doing anything irreversible - the stage name comes
 * from dennys as a free-form string, so it is the field that can push an
 * otherwise ordinary series over the cap.
 */
export function seriesDataFits(originalUserId: string, seriesData: SeriesData): boolean {
  const worstCase = serializeButtonData(
    'x'.repeat(LONGEST_TAG_LENGTH),
    originalUserId,
    { ...seriesData, seriesId: WORST_CASE_SERIES_ID },
    WORST_CASE_TAG_ARG,
  );
  return worstCase.length <= MAX_CUSTOM_ID_LENGTH;
}

export function createButtonData(
  tag: string,
  originalUserId: string,
  seriesData: SeriesData,
  tagArg?: string,
): ButtonData {
  return {
    tag,
    tagArg,
    originalUserId,
    seriesData,
    serialize() {
      const customId = serializeButtonData(
        this.tag,
        this.originalUserId,
        this.seriesData,
        this.tagArg,
      );
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
  // Split the argument off before mapping. A tag that never carried one is
  // unaffected, and no registered code contains a dot, so this cannot bite an
  // id minted before tag arguments existed.
  const separator = parts[0].indexOf(TAG_ARG_SEPARATOR);
  const tagCode = separator === -1 ? parts[0] : parts[0].slice(0, separator);
  const tagArg = separator === -1 ? undefined : parts[0].slice(separator + 1);
  // Legacy ids carry the full name, which is never also a code, so the fallback
  // covers them. Everything downstream - handlers.ts, the collector filters,
  // the logs - only ever sees the readable name.
  const tag = TAG_NAMES[tagCode] ?? tagCode;
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
    tagArg,
    originalUserId,
    seriesData: isVersioned ? decodeSeriesData(fields) : decodeLegacySeriesData(fields),
    serialize: () => customId,
  };
}
