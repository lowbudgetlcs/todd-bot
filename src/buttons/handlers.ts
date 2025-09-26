import { handleBothTeamSubmission, handleTeamSelect} from "../commands/tournament.ts";
import { handleSwitchSides } from "./handlers/switchSides.ts";
import { handleGenerateAnotherConfirm } from "./handlers/generateAnotherConfirm.ts";
import { handleGenerateAnotherCode } from "./handlers/generateAnotherCode.ts";
import { handleEndSeries } from "./handlers/endSeries.ts";
import log from 'loglevel';
// import { handleRegenerateCode } from "./handlers/regenerateCode.ts";
import { handleCancel } from "./handlers/cancelFlow.ts";

const logger =log.getLogger('handlers');
logger.setLevel('info');

export function getButtonHandler(tag: string) {
  logger.log(`getButtonHandler called with tag: ${tag}`);
  switch(tag) {
    case 'generate_another':
    case 'cancel_switch':
        return handleGenerateAnotherCode;
    // case 'regenerate_code':
    //     return handleRegenerateCode;
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
    case "cancel_flow":
      return handleCancel;
    default:
      logger.log(`No handler found for tag: ${tag}`);
      return null;
  }
}
