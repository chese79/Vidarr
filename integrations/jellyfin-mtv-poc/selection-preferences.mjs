export const fields=['SubtitleMode','SubtitleLanguagePreference'];
export const testPreferences={SubtitleMode:'Always',SubtitleLanguagePreference:'eng'};
export function snapshot(configuration) {
  return Object.fromEntries(fields.map(key=>[key,{present:Object.hasOwn(configuration,key),value:configuration[key]??null}]));
}
export function restore(configuration,original) {
  const result={...configuration};
  for(const key of fields) {
    const saved=original[key];
    const alreadyRestored=saved.present?configuration[key]===saved.value:!Object.hasOwn(configuration,key);
    if(!alreadyRestored&&configuration[key]!==testPreferences[key])throw new Error(`Subtitle preference ${key} changed independently; manual review required`);
    if(saved.present)result[key]=saved.value;else delete result[key];
  }
  return result;
}
