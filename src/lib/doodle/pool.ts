import "server-only";

export type PoolItem = { key: string; svg: string };

// v1 placeholder doodles — clean black-on-transparent SVGs.
// These will be replaced with sourced Mandy IP art in a follow-up;
// the API stays the same.
export const POOL: PoolItem[] = [
  {
    key: "bunny",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="50" cy="65" rx="22" ry="20"/>
<ellipse cx="40" cy="35" rx="6" ry="18"/>
<ellipse cx="60" cy="35" rx="6" ry="18"/>
<circle cx="44" cy="62" r="2" fill="#000"/>
<circle cx="56" cy="62" r="2" fill="#000"/>
<path d="M48 70 Q50 73 52 70"/>
</svg>`,
  },
  {
    key: "flower",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<circle cx="50" cy="50" r="8"/>
<circle cx="50" cy="32" r="10"/>
<circle cx="68" cy="50" r="10"/>
<circle cx="50" cy="68" r="10"/>
<circle cx="32" cy="50" r="10"/>
</svg>`,
  },
  {
    key: "star",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<polygon points="50,15 58,40 85,40 63,56 71,82 50,66 29,82 37,56 15,40 42,40"/>
</svg>`,
  },
  {
    key: "cloud",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M30 65 Q15 65 15 50 Q15 38 30 38 Q32 25 48 25 Q65 25 68 40 Q85 40 85 55 Q85 65 70 65 Z"/>
</svg>`,
  },
];

export function hashSeed(input: string): number {
  // cyrb53-lite — deterministic, fast, no deps.
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0);
}

export function pickDefaultForCup(lineId: string, cupIdx: number): PoolItem {
  const seed = hashSeed(`${lineId}:${cupIdx}`);
  return POOL[seed % POOL.length];
}
