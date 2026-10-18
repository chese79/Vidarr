import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_VALIDATION_SETTINGS, type ValidationCategory, type ValidationSettings } from '@vidarr/shared-types';
import { api } from '../api/client';
import QualityProfilesPage from './QualityProfilesPage';

const categories: Array<{ key: ValidationCategory; name: string; explanation: string }> = [
  { key: 'imports', name: 'Initial user imports', explanation: 'Existing local user files, including canonical matches. Validate and register existing files in place.' },
  { key: 'canonical', name: 'Canonical source downloads', explanation: 'An accepted, confirmed authoritative or verified source. The selected source determines the category.' },
  { key: 'additional', name: 'Supplementary & additional videos', explanation: 'Other approved sources, indexer downloads and sources without confirmed canonical authority.' },
];

export default function ValidationQualityPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['validationSettings'], queryFn: api.validation.get });
  const [draft, setDraft] = useState<ValidationSettings | null>(null);
  const [message, setMessage] = useState('');
  const settings = draft ?? query.data ?? DEFAULT_VALIDATION_SETTINGS;
  const save = useMutation({ mutationFn: api.validation.save, onSuccess: result => {
    client.setQueryData(['validationSettings'], result); setDraft(null);
    setMessage('Validation settings saved. New downloads and queued videos use the current category settings when validation starts.');
  } });
  const change = (next: ValidationSettings) => { setDraft(next); setMessage('Unsaved changes'); };
  const check = (key: ValidationCategory, field: 'file' | 'motion', value: boolean) => change({ ...settings,
    policies: { ...settings.policies, [key]: { ...settings.policies[key], [field]: value } } });

  return <div>
    <div className="page-header"><h2>Validation/Quality</h2></div>
    <h3>Validation by video category</h3>
    <p>Checked means run that step. The same label performs the same action in every category.</p>
    <div className="validation-explanations">
      <div><h4>1 · Check video file</h4><p>Confirm the file contains a video stream and meets the minimum dimensions. Reject audio-only files and tiny embedded artwork.</p><p>If unchecked: no video-stream or minimum-size inspection is performed.</p></div>
      <div><h4>2 · Check video motion</h4><p>Inspect the full video for static imagery. Reject it when static imagery exceeds the configured percentage.</p><p>If unchecked: album-art or mostly static videos can pass through. This check uses processing time and can flag intentionally still footage.</p></div>
      <div><h4>3 · Import / register</h4><p>Import downloads and metadata into the library and record ownership. Existing user files are registered in place. Required for every category.</p></div>
      <div><h4>4 · Confirm delivery</h4><p>Confirm that the configured Plex/Jellyfin library reports the exact file. A refresh acknowledgement alone is insufficient. Until then, the video remains awaiting confirmation. Required for every category.</p></div>
    </div>
    {query.isLoading && <p role="status">Loading validation settings…</p>}
    {query.isError && <p role="alert">Could not load validation settings: {(query.error as Error).message}</p>}
    <form onSubmit={event => { event.preventDefault(); save.mutate(settings); }}>
      <fieldset disabled={!query.isSuccess || save.isPending} className="validation-fieldset">
        {categories.map(category => <div className="validation-policy" key={category.key}>
          <div><strong>{category.name}</strong><p>{category.explanation}</p></div>
          <label><input type="checkbox" checked={settings.policies[category.key].file} onChange={e => check(category.key, 'file', e.target.checked)} aria-label={`Check video file for ${category.name}`} />Check video file</label>
          <label><input type="checkbox" checked={settings.policies[category.key].motion} onChange={e => check(category.key, 'motion', e.target.checked)} aria-label={`Check video motion for ${category.name}`} />Check video motion</label>
          <label><input type="checkbox" checked disabled readOnly />Import / register <small>Required</small></label>
          <label><input type="checkbox" checked disabled readOnly />Confirm delivery <small>Required</small></label>
        </div>)}
        <h3>Validation thresholds</h3>
        <div className="form-row">
          <label>Minimum width/height (pixels) <input type="number" min="1" max="8192" required value={settings.minimumDimension}
            onChange={e => change({ ...settings, minimumDimension: Number(e.target.value) })} /></label>
          <label>Reject when static for more than (%) <input type="number" min="1" max="100" required value={settings.maximumStaticPercent}
            onChange={e => change({ ...settings, maximumStaticPercent: Number(e.target.value) })} /></label>
        </div>
        <p>Thresholds apply only when the corresponding check is enabled. Identity, source acceptance and excluded-content rules still apply before acquisition.</p>
        <p>These inspections do not guarantee audio integrity or detect every damaged file. A motion check with an undetermined duration currently allows import.</p>
        <h3>When updated settings apply</h3>
        <p>Newly downloaded videos use the saved choices when validation starts. Queued videos retain the category assigned from their selected source and use the settings in effect when validation starts. Checks already running keep their current settings.</p>
        <button type="submit" disabled={!draft || save.isPending}>{save.isPending ? 'Saving…' : 'Save validation settings'}</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {save.isError && <p role="alert">Save failed: {(save.error as Error).message}</p>}
    </form>
    <p><Link to="/live/settings">Configure live performance validation, destinations and quality preferences</Link></p>
    <section className="validation-quality-profiles" aria-label="Quality profiles">
      <p>Quality profiles choose allowed formats and upgrade cutoffs. Existing profiles and artist assignments are retained.</p>
      <QualityProfilesPage />
    </section>
  </div>;
}
