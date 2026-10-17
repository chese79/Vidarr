import { z } from 'zod';

export const LiveSetting = z.enum(['concert', 'festival', 'televisionRadio', 'studioSession', 'informalGathering']);
export const LiveStyle = z.enum(['acoustic', 'electric', 'mixed', 'unknown']);
export const RecordingCoverage = z.enum(['entirePerformance', 'severalSongs', 'individualSong', 'excerpt', 'unknown']);
const text = z.string().trim().min(1).max(300);
export const PerformanceDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).refine(value => {
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999 || (month != null && (month < 1 || month > 12))) return false;
  if (day == null) return true;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Enter a valid year, year-month or full performance date');

export const CreateLivePerformance = z.object({
  artistId: z.number().int().positive(), title: text,
  performanceDate: PerformanceDate.nullable().default(null),
  venue: text.nullable().default(null), city: text.nullable().default(null),
  setting: LiveSetting.default('concert'), style: LiveStyle.default('unknown'),
  notes: z.string().trim().max(5000).default(''),
  songs: z.array(z.object({ title: text, section: text.nullable().default(null),
    kind: z.enum(['full', 'snippet', 'medleyComponent', 'unknown']).default('unknown') }).strict()).max(500).default([]),
}).strict();
export type CreateLivePerformance = z.input<typeof CreateLivePerformance>;
export const UpdateLivePerformance = CreateLivePerformance.omit({ artistId: true, songs: true }).partial()
  .extend({ revision: z.number().int().positive() }).strict();
export type UpdateLivePerformance = z.input<typeof UpdateLivePerformance>;

export const CreateRecordingCandidate = z.object({
  title: text, performanceIds: z.array(z.number().int().positive()).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Duplicate performance links'),
  claimedCoverage: RecordingCoverage.default('unknown'),
  origin: z.enum(['professional', 'audience', 'unknown']).default('unknown'),
  evidenceUrl: z.string().url().max(2000).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, 'Use an HTTP(S) evidence URL without embedded credentials').nullable().default(null),
  notes: z.string().trim().max(5000).default(''),
}).strict();
export type CreateRecordingCandidate = z.input<typeof CreateRecordingCandidate>;

export interface LiveArtist { id: number; name: string }
export interface LivePerformanceSummary {
  id: number; artistId: number; artist: LiveArtist; title: string; performanceDate: string | null;
  venue: string | null; city: string | null; setting: z.infer<typeof LiveSetting>; style: z.infer<typeof LiveStyle>;
  identityStatus: 'independent'; revision: number; notes: string;
  recordingState: 'recordingUnknown'; _count: { songs: number; recordings: number };
}
export interface RecordingCandidate {
  id: number; title: string; claimedCoverage: z.infer<typeof RecordingCoverage>;
  origin: 'professional' | 'audience' | 'unknown'; evidenceUrl: string | null; notes: string; reviewStatus: 'pending';
  performances: Array<{ performance: { id: number; title: string; artist: LiveArtist } }>;
}
export interface LivePerformanceDetail extends LivePerformanceSummary {
  songs: Array<{ id: number; position: number; title: string; section: string | null; kind: string }>;
  recordings: Array<{ recording: RecordingCandidate }>;
}
export interface LivePage<T> { items: T[]; total: number; offset: number; limit: number }
