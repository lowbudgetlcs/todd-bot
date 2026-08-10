import { handleBothTeamSubmission, handleTeamSelect} from "../commands/tournament.ts";
import { handleSwitchSides } from "./handlers/switchSides.ts";
import { handleGenerateAnotherConfirm } from "./handlers/generateAnotherConfirm.ts";
import { handleGenerateAnotherCode } from "./handlers/generateAnotherCode.ts";
import log from 'loglevel';
// import { handleRegenerateCode } from "./handlers/regenerateCode.ts";
import { handleCancel } from "./handlers/cancelFlow.ts";
import { handleReportResult, handleReportTeam1Won, handleReportTeam2Won } from "./handlers/reportResult.ts";
import { handleCodeNotWorking, handlePlayCustom, handlePlayCustomConfirm } from "./handlers/recovery.ts";

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
    // Both issue a code for the same game number. They differ only in whether
    // the captain declared the existing code dead, which the handler reads off
    // the tag to decide if that code's message should go.
    case 'generate_another_confirm':
    case 'regenerate_confirm':
      return handleGenerateAnotherConfirm;
    case 'switch_sides':
      return handleSwitchSides;
    // Both open the winner picker. They differ only in whether dennys could
    // possibly know the result already, which the handler reads off the tag
    // before deciding to check.
    case 'report_result':
    case 'report_custom':
      return handleReportResult;
    case 'report_team1_won':
      return handleReportTeam1Won;
    case 'report_team2_won':
      return handleReportTeam2Won;
    case 'code_not_working':
      return handleCodeNotWorking;
    case 'play_custom':
      return handlePlayCustom;
    case 'play_custom_confirm':
      return handlePlayCustomConfirm;
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
