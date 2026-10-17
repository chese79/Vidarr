import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LiveSetting, LiveStyle, type LivePerformanceDetail } from '@vidarr/shared-types';
import { liveLabels } from '../pages/LivePage';
import { api } from '../api/client';

export default function LiveMetadataEditor({ performance, onSaved }: { performance: LivePerformanceDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(performance.title);
  const [date, setDate] = useState(performance.performanceDate ?? '');
  const [venue, setVenue] = useState(performance.venue ?? '');
  const [city, setCity] = useState(performance.city ?? '');
  const [setting, setSetting] = useState(performance.setting);
  const [style, setStyle] = useState(performance.style);
  const [notes, setNotes] = useState(performance.notes);
  const save = useMutation({ mutationFn: () => api.live.updatePerformance(performance.id, {
    revision: performance.revision, title, performanceDate: date.trim() || null,
    venue: venue.trim() || null, city: city.trim() || null, setting, style, notes,
  }), onSuccess: onSaved });
  return <details className="card"><summary>Edit performance details</summary>
    <form onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <label>Title <input required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Performance date <input placeholder="YYYY, YYYY-MM or YYYY-MM-DD" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>Venue or public location label <input maxLength={300} value={venue} onChange={e => setVenue(e.target.value)} /></label>
      <label>City <input maxLength={300} value={city} onChange={e => setCity(e.target.value)} /></label>
      <label>Setting <select value={setting} onChange={e => setSetting(e.target.value as typeof setting)}>{LiveSetting.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
      <label>Style <select value={style} onChange={e => setStyle(e.target.value as typeof style)}>{LiveStyle.options.map(value => <option key={value} value={value}>{liveLabels[value]}</option>)}</select></label>
      <label>Notes <textarea maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <p>Corrections keep song and recording links intact. Identity remains independent until the future matching/review workflow verifies it.</p>
      {save.isError && <p role="alert">{save.error.message}</p>}
      <button disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save corrections'}</button>
    </form>
  </details>;
}
