import { Children, forwardRef, isValidElement, useEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type FormHTMLAttributes, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { bindButtonMutations, ButtonAction, feedbackAnnouncements, withButtonAction } from '../buttonFeedback';

const buttonActions = new WeakMap<HTMLButtonElement, ButtonAction>();
function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number'
    ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '').join('');
}
function observeResult(action: ButtonAction, result: unknown) {
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    // Page handlers keep their own error presentation; feedback observes rejection as well.
    void action.track(result as PromiseLike<unknown>).catch(() => {});
  }
}

export const ActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ActionButton(
  { children, onClick, disabled, className, style, ...props }, forwardedRef,
) {
  const [action] = useState(() => new ButtonAction());
  const feedback = useSyncExternalStore(action.subscribe, action.snapshot, action.serverSnapshot);
  const [pressedWidth, setPressedWidth] = useState(0);
  const pending = feedback.phase === 'pending';
  const currentText = textOf(children);
  const specificPendingLabel = pending && currentText !== feedback.pressedText;
  const message = feedback.phase === 'engaged' ? 'Clicked' : pending && !specificPendingLabel ? 'Working…' : feedback.phase === 'error' ? 'Failed' : null;
  return <button {...props} ref={element => {
    if (element) buttonActions.set(element, action);
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }} disabled={disabled || pending} aria-busy={pending || props['aria-busy'] || undefined}
    data-button-feedback={feedback.phase === 'idle' ? undefined : feedback.phase}
    className={className} style={feedback.phase === 'idle' ? style : { ...style, minWidth: Math.max(pressedWidth, typeof style?.minWidth === 'number' ? style.minWidth : 0) }}
    onClick={event => {
      if (action.busy) { event.preventDefault(); event.stopPropagation(); return; }
      setPressedWidth(event.currentTarget.getBoundingClientRect().width);
      action.begin(currentText, props['aria-label'] || currentText);
      try { observeResult(action, withButtonAction(action, () => onClick?.(event))); }
      catch (error) { action.hold()(true); throw error; }
    }}>{message || children}</button>;
});

export const ActionForm = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(function ActionForm({ onSubmit, ...props }, ref) {
  const submitting = useRef(false);
  return <form {...props} ref={ref} onSubmit={event => {
    if (submitting.current) { event.preventDefault(); return; }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter instanceof HTMLButtonElement ? buttonActions.get(submitter) : undefined;
    if (!action) { onSubmit?.(event); return; }
    if (!action.busy && action.snapshot().phase !== 'engaged') action.begin(action.snapshot().pressedText || submitter?.textContent || 'Submit');
    try {
      const result: unknown = withButtonAction(action, () => onSubmit?.(event));
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        submitting.current = true;
        void action.track(result as PromiseLike<unknown>).catch(() => {}).finally(() => { submitting.current = false; });
      }
    } catch (error) { action.hold()(true); throw error; }
  }} />;
});

export function ButtonFeedback({ client, children }: { client: QueryClient; children: ReactNode }) {
  useEffect(() => bindButtonMutations(client), [client]);
  const message = useSyncExternalStore(feedbackAnnouncements.subscribe, feedbackAnnouncements.snapshot, feedbackAnnouncements.serverSnapshot);
  return <>{children}<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</div></>;
}
