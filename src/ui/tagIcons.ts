import { getTagIconCache, saveTagIconCache } from "../config/storage";
import { TagIconCache, TagIconEntry } from "../types";

export type TagIconData = {
  icon: string;
  color?: string | null;
};

export type TagIconMap = Map<string, TagIconData>;

const TAG_ICON_LIST_REGEX = /tag_icon_list\s*:\s*["']([^"']*)["']/;
const TAG_PREFETCH_DELAY_MS = 3000;
let tagIconMap: TagIconMap | null = null;
let tagIconPromise: Promise<TagIconMap | null> | null = null;
let tagPrefetchTimeoutId: number | null = null;

function normalizeTagName(tag: string): string {
  return tag.trim().toLowerCase();
}

function buildTagIconMap(entries: TagIconEntry[]): TagIconMap {
  const map = new Map<string, TagIconData>();
  entries.forEach((entry) => {
    const key = normalizeTagName(entry.tag);
    if (!key || !entry.icon) {
      return;
    }
    map.set(key, { icon: entry.icon, color: entry.color ?? null });
  });
  return map;
}

function loadCachedTagIconMap(): TagIconMap | null {
  if (tagIconMap) {
    return tagIconMap;
  }
  const cache = getTagIconCache();
  if (!cache || !Array.isArray(cache.entries)) {
    return null;
  }
  tagIconMap = buildTagIconMap(cache.entries);
  return tagIconMap;
}

function persistTagIconMap(map: TagIconMap): void {
  tagIconMap = map;
  const entries: TagIconEntry[] = [];
  map.forEach((value, key) => {
    entries.push({
      tag: key,
      icon: value.icon,
      color: value.color ?? null,
    });
  });
  const cache: TagIconCache = {
    updatedAt: Date.now(),
    entries,
  };
  saveTagIconCache(cache);
}

function decodeTagIconList(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\"/g, '"');
  }
}

function parseTagIconList(raw: string): TagIconMap {
  const map = new Map<string, TagIconData>();
  const normalizedRaw = decodeTagIconList(raw);
  normalizedRaw.split("|").forEach((item) => {
    const [tag, icon, color] = item.split(",").map((value) => value.trim());
    if (!tag || !icon) {
      return;
    }
    map.set(normalizeTagName(tag), {
      icon,
      color: color || null,
    });
  });
  return map;
}

function getLinkThemeJavascriptUrls(): string[] {
  const urls = new Set<string>();
  document
    .querySelectorAll<HTMLLinkElement>('link[href*="theme-javascripts"]')
    .forEach((link) => {
      if (link.href) {
        urls.add(link.href);
      }
    });
  return Array.from(urls);
}

function getResourceThemeJavascriptUrls(): string[] {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return [];
  }
  const urls = new Set<string>();
  performance.getEntriesByType("resource").forEach((entry) => {
    if (typeof entry.name === "string" && entry.name.includes("theme-javascripts")) {
      urls.add(entry.name);
    }
  });
  return Array.from(urls);
}

function findThemeJavascriptUrls(): string[] {
  const urls = new Set<string>();
  document
    .querySelectorAll<HTMLScriptElement>('script[src*="theme-javascripts"]')
    .forEach((script) => {
      if (script.src) {
        urls.add(script.src);
      }
    });
  getLinkThemeJavascriptUrls().forEach((url) => urls.add(url));
  getResourceThemeJavascriptUrls().forEach((url) => urls.add(url));
  return Array.from(urls);
}

async function fetchTagIconListFromTheme(
  signal?: AbortSignal
): Promise<string | null> {
  const urls = findThemeJavascriptUrls();
  for (const url of urls) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const response = await fetch(url, {
      signal,
      credentials: "same-origin",
    });
    if (!response.ok) {
      continue;
    }
    const text = await response.text();
    const match = text.match(TAG_ICON_LIST_REGEX);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function getCachedTagIconMap(): TagIconMap | null {
  return loadCachedTagIconMap();
}

export async function ensureTagIconMap(
  signal?: AbortSignal
): Promise<TagIconMap | null> {
  const cached = loadCachedTagIconMap();
  if (cached && cached.size > 0) {
    return cached;
  }
  if (tagIconPromise) {
    return tagIconPromise;
  }
  const fetchPromise = (async () => {
    const list = await fetchTagIconListFromTheme(signal);
    if (!list) {
      return cached ?? null;
    }
    const map = parseTagIconList(list);
    if (map.size > 0) {
      persistTagIconMap(map);
      return map;
    }
    return cached ?? null;
  })();
  tagIconPromise = fetchPromise;
  try {
    return await fetchPromise;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    console.warn("Failed to fetch tag icons:", error);
    return cached ?? null;
  } finally {
    if (tagIconPromise === fetchPromise) {
      tagIconPromise = null;
    }
  }
}

export function scheduleTagIconPrefetch(): void {
  const cached = loadCachedTagIconMap();
  if (cached && cached.size > 0) {
    return;
  }
  if (tagPrefetchTimeoutId !== null) {
    return;
  }
  const schedule = () => {
    tagPrefetchTimeoutId = window.setTimeout(() => {
      tagPrefetchTimeoutId = null;
      ensureTagIconMap().catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Failed to prefetch tag icons:", error);
        }
      });
    }, TAG_PREFETCH_DELAY_MS);
  };
  if (document.readyState === "complete" || document.readyState === "interactive") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }
}
