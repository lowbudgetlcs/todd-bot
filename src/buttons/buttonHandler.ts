import { handleCancelSwitch, handleEndSeries, handleGenerateAnotherCode, handleGenerateAnotherConfirm, handleSwitchSidesConfirm } from "./codeGenerators";

/* Maps customId to button handler callback */
export function getButtonHandler(customId: string) {
  switch(customId.substring(0, customId.indexOf(':'))) {
    case 'generate_another':
        return handleGenerateAnotherCode;
    case 'generate_another_confirm':
      return handleGenerateAnotherConfirm;
    case 'switch_sides_confirm':
      return handleSwitchSidesConfirm;
    case 'end_series':
      return handleEndSeries;
    case 'cancel_switch': 
      return handleCancelSwitch;
  }
}
