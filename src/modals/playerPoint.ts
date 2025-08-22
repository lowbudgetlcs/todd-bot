import { ModalSubmitInteraction } from "discord.js";
import log from 'loglevel';
import { rankToPoints } from "../utilities/playerPointCalculator";

const logger =log.getLogger('player point modal');
logger.setLevel('info');


export async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== "rankModal") return;

  const games = interaction.fields.getTextInputValue("games");

  const peak2025 = interaction.fields.getTextInputValue("peak2025");
  const peakSince2024 = interaction.fields.getTextInputValue("peakSince2024");
  const points = parseInt(games, 10) < 100? rankToPoints(peakSince2024) : rankToPoints(peak2025);
  // Example calculation logic (can expand later)
  const calcResult = 
`📊 **Ranked Summary**
- Games in S2025: **${games}**
- Peak Rank in S2025: **${peak2025}**
- Peak Rank Since S2024: **${peakSince2024}**

✨ Estimated Point Value: **__${points} POINTS__**

---

⚠️ *This is a point estimate based on the information you provided.  
LBLCS staff may assign you a higher point value if you have a low number of ranked games or if they believe your rank is not an accurate reflection of your skill.*  
(See section **[1.2]** in the rules for details on point assignments.)`;


  await interaction.reply({
    content: calcResult,
    ephemeral: true,
  });
}