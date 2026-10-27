/** The overhealed part of what heals healed and overhealed together (0–1); `null` when they did neither. */
export const overhealShare = (overheal: number, healed: number): number | null => (healed + overheal > 0 ? overheal / (healed + overheal) : null);
