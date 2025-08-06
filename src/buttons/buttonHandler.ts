import { handleBothTeamSubmission, handleTeamSelect } from "../commands/tournament";
import {  handleEndSeries, handleGenerateAnotherCode, handleGenerateAnotherConfirm, handleSwitchSides } from "./codeGenerators";
/* Maps customId to button handler callback */
export function getButtonHandler(tag: string) {

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
      return handleTeamSelect;
  }
}
