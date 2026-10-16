/** Structural checks only; the acquiring activity determines the MOS and task time. */
export function validateSkillEntries(entries: string[]): string[] {
  const records = entries.flatMap((text) => text.split(/[;\n]+/)).map((text) => text.trim()).filter(Boolean);
  if (!records.length) return ['Enter the required MOS title and time in hours in Skill and Time Required.'];
  const errors: string[] = [];
  for (const record of records) {
    const times = [...record.matchAll(/([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:hours?|hrs?)\b/gi)];
    if (!times.length || !/[a-z]/i.test(record.slice(0, times[0]?.index))) {
      errors.push('Give each required MOS title its time in numeric hours, for example Equipment technician, 0.5 hours.');
    }
    if (/\d\s*\/\s*\d+\s*(?:hours?|hrs?)\b/i.test(record) || times.some((match) => {
      const hours = Number(match[1]);
      return hours <= 0 || (hours < 1 && Math.abs(hours * 10 - Math.round(hours * 10)) > 1e-8);
    })) errors.push('Use positive hours; express times below one hour in tenths, for example 0.5 hours.');
  }
  return [...new Set(errors)];
}
