export const MILITARY_DICTIONARY = [
  "SITREP",
  "Roger that",
  "Copy that",
  "Over and out",
  "RTB",
  "ETA",
  "QRF",
  "LOC",
  "LAC",
  "CO",
  "JCO",
  "NCO",
  "HQ",
  "CASEVAC",
  "MEDEVAC",
  "FOB",
  "ROE",
  "SOP",
  "Affirmative",
  "Negative",
  "Acknowledge",
  "Stand by",
  "IED",
  "OP",
  "LP",
  "Ambush",
  "Reconnaissance",
  "Artillery",
  "Infantry",
  "Basecamp",
  "Cantonment"
];

/**
 * Returns a suggestion from the dictionary if the input exactly matches the start of a term.
 * @param input The current text in the input box
 * @returns The matched term, or null if no match or if the input is empty
 */
export function getMilitarySuggestion(input: string): string | null {
  if (!input || input.trim().length === 0) return null;

  const words = input.split(" ");
  const lastWord = words[words.length - 1];

  if (lastWord.length === 0) return null;

  const lowerLastWord = lastWord.toLowerCase();

  // Find first term that starts with the current word
  const match = MILITARY_DICTIONARY.find(term => term.toLowerCase().startsWith(lowerLastWord));

  if (match) {
    // If it perfectly equals the term (ignoring case), we don't need to suggest it anymore
    if (match.toLowerCase() === lowerLastWord) {
      return null;
    }
    return match;
  }

  return null;
}
