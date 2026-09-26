/**
 * Horizontal placement for icons in one chart lane. Icons keep their true x when there is room;
 * crowded ones are pushed apart by at least `gap`, left to right, and the whole run is shifted
 * back so it stays centred on the times it stands for and inside [min, max]. Each result keeps
 * the input's index, so a tick at the true time can still be drawn under a moved icon.
 */
export function dodgeLane(xs: number[], gap: number, min: number, max: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const placed: number[] = Array.from({ length: xs.length }, () => 0);
  // Group icons that would overlap into runs, then lay each run out evenly around its centre.
  let run: { x: number; i: number }[] = [];
  const flush = () => {
    if (!run.length) return;
    const width = (run.length - 1) * gap;
    const centre = (run[0].x + run[run.length - 1].x) / 2;
    const first = Math.min(Math.max(centre - width / 2, min), Math.max(min, max - width));
    run.forEach((item, k) => (placed[item.i] = first + k * gap));
    run = [];
  };
  for (const item of order) {
    const last = run.at(-1);
    // The run's current right edge, as laid out so far, decides whether this icon joins it.
    const edge = last
      ? Math.max((run[0].x + last.x) / 2 + ((run.length - 1) * gap) / 2, last.x)
      : -Infinity;
    if (last && item.x - edge < gap) run.push(item);
    else {
      flush();
      run.push(item);
    }
  }
  flush();
  return placed;
}
