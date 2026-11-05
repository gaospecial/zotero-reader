export function readStoredStar(id: string) {
  try { return window.localStorage.getItem(`reader-starred-${id}`) === 'true'; }
  catch { return false; }
}

export function writeStoredStar(id: string, starred: boolean) {
  try { window.localStorage.setItem(`reader-starred-${id}`, String(starred)); }
  catch { /* 存储不可用时仍保留当前界面状态。 */ }
}
