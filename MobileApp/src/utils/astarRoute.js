/**
 * Minimal A* on a complete graph (used to rank / reason about stop costs).
 * Same idea as the web dashboard routing module.
 */

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

class MinPQ {
  constructor() {
    this.a = [];
  }
  push(v, p) {
    this.a.push({ v, p });
    this.a.sort((x, y) => x.p - y.p);
  }
  pop() {
    return this.a.shift()?.v;
  }
  get size() {
    return this.a.length;
  }
}

function reconstruct(came, cur) {
  const path = [cur];
  let c = cur;
  while (came.has(c)) {
    c = came.get(c);
    path.unshift(c);
  }
  return path;
}

/**
 * @param {Array<{ id: string, lat: number, lng: number }>} nodes
 * @param {string} startId
 * @param {string} goalId
 * @returns {{ path: string[], cost: number } | null}
 */
export function runAStar(nodes, startId, goalId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(startId) || !byId.has(goalId)) return null;

  const open = new MinPQ();
  const came = new Map();
  const g = new Map();
  const f = new Map();
  const goal = byId.get(goalId);

  g.set(startId, 0);
  f.set(startId, haversineMeters(byId.get(startId), goal));
  open.push(startId, f.get(startId));

  while (open.size) {
    const current = open.pop();
    if (current === goalId) {
      return { path: reconstruct(came, current), cost: g.get(current) ?? 0 };
    }
    const curNode = byId.get(current);
    for (const n of nodes) {
      if (n.id === current) continue;
      const edge = haversineMeters(curNode, n);
      const tentative = (g.get(current) ?? Infinity) + edge;
      if (tentative < (g.get(n.id) ?? Infinity)) {
        came.set(n.id, current);
        g.set(n.id, tentative);
        f.set(n.id, tentative + haversineMeters(n, goal));
        open.push(n.id, f.get(n.id));
      }
    }
  }
  return null;
}
