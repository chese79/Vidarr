import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot,restore,testPreferences } from './selection-preferences.mjs';
test('restores only test fields and retains other preference changes',()=>{
  const saved=snapshot({SubtitleMode:'None',SubtitleLanguagePreference:'',Other:'before'});
  assert.deepEqual(restore({...testPreferences,Other:'changed'},saved),{SubtitleMode:'None',SubtitleLanguagePreference:'',Other:'changed'});
});
test('restoration is idempotent',()=>{const c={SubtitleMode:'None',SubtitleLanguagePreference:null};assert.deepEqual(restore(c,snapshot(c)),c);});
test('does not overwrite independent changes to a controlled field',()=>assert.throws(()=>restore({...testPreferences,SubtitleMode:'OnlyForced'},snapshot({SubtitleMode:'None'}))));
test('fields originally absent are removed again',()=>assert.deepEqual(restore({...testPreferences,Other:true},snapshot({})),{Other:true}));
