// A saved credential is indicated without loading its value into the form.
// Empty state still means "keep existing", so the mask is never submitted.
export function credentialPlaceholder(saved: boolean | undefined, label: string): string {
  return saved ? '•••••••• (saved; enter a replacement)' : label;
}
