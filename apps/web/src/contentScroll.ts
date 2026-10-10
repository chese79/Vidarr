export function contentScrollTop(): number {
  return document.getElementById('main-content')?.scrollTop ?? window.scrollY;
}

export function scrollContentTo(top: number): void {
  const content = document.getElementById('main-content');
  if (content) content.scrollTo(0, top);
  else window.scrollTo(0, top);
}
