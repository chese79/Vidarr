import type { QueryClient } from '@tanstack/react-query';

export type FeedbackPhase = 'idle' | 'engaged' | 'pending' | 'settled' | 'error';
interface FeedbackSnapshot { phase: FeedbackPhase; pressedText: string }
const idle: FeedbackSnapshot = { phase: 'idle', pressedText: '' };
let activeAction: ButtonAction | undefined;
let announcement = '';
const announcementListeners = new Set<() => void>();
export const feedbackAnnouncements = {
  subscribe(listener: () => void) { announcementListeners.add(listener); return () => { announcementListeners.delete(listener); }; },
  snapshot: () => announcement,
  serverSnapshot: () => '',
};
function announce(message: string) { announcement = message; announcementListeners.forEach(listener => listener()); }

export class ButtonAction {
  private state = idle;
  private listeners = new Set<() => void>();
  private resetTimer?: ReturnType<typeof setTimeout>;
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private pending = 0;
  private failed = false;
  private label = 'Action';
  snapshot = () => this.state;
  serverSnapshot = () => idle;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get busy() { return this.pending > 0; }
  begin(text: string, label = text) {
    clearTimeout(this.resetTimer);
    this.failed = false;
    this.label = label || 'Action';
    this.update('engaged', text);
    announce(`${this.label}: clicked.`);
    this.resetTimer = setTimeout(() => { if (!this.busy) this.update('idle'); }, 700);
  }
  private update(phase: FeedbackPhase, pressedText = this.state.pressedText) {
    this.state = { phase, pressedText };
    this.listeners.forEach(listener => listener());
  }
  hold() {
    this.pending++;
    clearTimeout(this.resetTimer);
    // Native submit-button activation must finish before the button becomes disabled.
    // Disabling synchronously in click can prevent the form's default submit entirely.
    if (!this.pendingTimer) this.pendingTimer = setTimeout(() => {
      this.pendingTimer = undefined;
      if (this.busy) { this.update('pending'); announce(`${this.label}: working.`); }
    }, 0);
    let released = false;
    return (failed = false) => {
      if (released) return;
      released = true;
      this.failed ||= failed;
      this.pending--;
      if (this.busy) return;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
      this.update(this.failed ? 'error' : this.state.phase === 'pending' ? 'settled' : 'engaged');
      if (this.failed) announce(`${this.label}: failed. Check the error message and try again.`);
      else announce(`${this.label}: response received.`);
      this.resetTimer = setTimeout(() => this.update('idle'), this.failed ? 1600 : 700);
    };
  }
  track<T>(promise: PromiseLike<T>): Promise<T> {
    const release = this.hold();
    return Promise.resolve(promise).then(value => { release(); return value; }, error => { release(true); throw error; });
  }
}

export function withButtonAction<T>(action: ButtonAction, callback: () => T): T {
  const previous = activeAction;
  activeAction = action;
  try { return callback(); } finally { activeAction = previous; }
}
export function trackButtonRequest<T>(promise: Promise<T>): Promise<T> {
  return activeAction ? activeAction.track(promise) : promise;
}
export function bindButtonMutations(client: QueryClient) {
  const associations = new WeakMap<object, { action: ButtonAction; release?: (failed?: boolean) => void }>();
  return client.getMutationCache().subscribe(event => {
    if (!['added', 'updated', 'removed'].includes(event.type) || !('mutation' in event)) return;
    const mutation = event.mutation;
    if (!mutation) return;
    if (event.type === 'added' && activeAction) associations.set(mutation, { action: activeAction });
    const association = associations.get(mutation);
    if (!association) return;
    if (mutation.state.status === 'pending' && !association.release) association.release = association.action.hold();
    if (['success', 'error'].includes(mutation.state.status) || event.type === 'removed') {
      association.release?.(mutation.state.status === 'error');
      associations.delete(mutation);
    }
  });
}
