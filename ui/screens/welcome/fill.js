// How far filling in the films has got, for the onboarding's slim bar: the same per-film figures as Settings → Sources
// ("% filled in", covers and details), told as "n of N films". getState sends them; the core nudges a re-read every few seconds while it works.
export function fillOf(core, total = (core && core.counts && core.counts.films) || 0) {
  const cats = (core && core.progress && core.progress.categories || []).filter(c => c.id === 'covers' || c.id === 'details');
  const all = cats.reduce((n, c) => n + c.total, 0), done = cats.reduce((n, c) => n + c.done, 0);
  let share = all ? done / all : (core && core.job ? 0 : 1);
  if (core && core.job && core.job.total > 1 && !all) share = Math.min(1, (core.job.done || 0) / core.job.total);
  share = Math.max(0, Math.min(1, share));
  const n = Math.round(share * total);
  return { done: n, total, pct: total ? Math.round(share * 100) : 0, complete: total > 0 && n >= total };
}
