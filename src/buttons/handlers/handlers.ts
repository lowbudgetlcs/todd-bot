import { handleBothTeamSubmission, handleTeamSelect} from "../../commands/tournament.ts";
import { handleSwitchSides } from "./switchSides.ts";
import { handleGenerateAnotherConfirm } from "./generateAnotherConfirm.ts";
import { handleGenerateAnotherCode } from "./generateAnotherCode.ts";
import { handleEndSeries } from "./endSeries.ts";
import log from 'loglevel';

const logger =log.getLogger('handlers');
logger.setLevel('info');

export function getButtonHandler(tag: string) {
  logger.log(`getButtonHandler called with tag: ${tag}`);
  switch(tag) {
    case 'generate_another':
    case 'cancel_switch':
        return handleGenerateAnotherCode;
    case 'generate_another_confirm':
      return handleGenerateAnotherConfirm;
    case 'switch_sides':
      return handleSwitchSides;
    case 'end_series':
      return handleEndSeries;
    case 'confirm':
      return handleBothTeamSubmission; // Assuming confirm is used for ending series
    case "switch":
    case "cancel":
      logger.log("Switch or cancel button pressed, returning handleTeamSelect");
      return handleTeamSelect;
    default:
      logger.log(`No handler found for tag: ${tag}`);
      return null;
  }
}
