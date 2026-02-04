import { getEmojiCache, saveEmojiCache } from "../config/storage";
import { EmojiCache, EmojiEntry } from "../types";

export type EmojiMap = Map<string, string>;

type EmojiResponseEntry = {
  name?: string;
  url?: string;
};

type EmojiResponse = Record<string, EmojiResponseEntry[]>;

const EMOJI_ENDPOINT = `${window.location.origin}/emojis.json`;
const CUSTOM_LIST_CONTAINER_ID = "custom-topic-list-container";
const EMOJI_TEXT_ATTR = "data-emoji-text";
const EMOJI_RENDERED_ATTR = "data-emoji-rendered";
const EMOJI_IMAGE_CLASS = "emoji";
const EMOJI_PATTERN = /:([a-zA-Z0-9_+-]+):/g;

let emojiMap: EmojiMap | null = null;
let emojiPromise: Promise<EmojiMap | null> | null = null;

function buildEmojiMap(entries: EmojiEntry[]): EmojiMap {
  const map = new Map<string, string>();
  entries.forEach((entry) => {
    if (!entry.name || !entry.url) {
      return;
    }
    map.set(entry.name, entry.url);
  });
  return map;
}

function loadEmojiCache(): EmojiMap | null {
  if (emojiMap) {
    return emojiMap;
  }
  const cache = getEmojiCache();
  if (!cache || !Array.isArray(cache.entries) || typeof cache.updatedAt !== "number") {
    return null;
  }
  emojiMap = buildEmojiMap(cache.entries);
  return emojiMap;
}

function persistEmojiCache(map: EmojiMap): void {
  emojiMap = map;
  const entries: EmojiEntry[] = [];
  map.forEach((url, name) => {
    entries.push({ name, url });
  });
  const cache: EmojiCache = {
    updatedAt: Date.now(),
    entries,
  };
  saveEmojiCache(cache);
}

function normalizeEmojiUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch (error) {
    return url;
  }
}

function parseEmojiResponse(data: EmojiResponse): EmojiMap {
  const entries: EmojiEntry[] = [];
  Object.values(data).forEach((groupList) => {
    if (!Array.isArray(groupList)) {
      return;
    }
    groupList.forEach((entry) => {
      if (!entry?.name || !entry.url) {
        return;
      }
      entries.push({
        name: entry.name,
        url: normalizeEmojiUrl(entry.url),
      });
    });
  });
  return buildEmojiMap(entries);
}

async function fetchEmojiMap(signal?: AbortSignal): Promise<EmojiMap | null> {
  const response = await fetch(EMOJI_ENDPOINT, {
    signal,
    credentials: "same-origin",
  });
  if (!response.ok) {
    return null;
  }
  const data: EmojiResponse = await response.json();
  const map = parseEmojiResponse(data);
  return map.size > 0 ? map : null;
}

export function extractEmojiNames(text: string): string[] {
  const names: string[] = [];
  EMOJI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMOJI_PATTERN.exec(text))) {
    names.push(match[1]);
  }
  return names;
}

export function markEmojiText(span: HTMLSpanElement, text: string): void {
  const names = extractEmojiNames(text);
  if (names.length === 0) {
    return;
  }
  span.setAttribute(EMOJI_TEXT_ATTR, text);
}

export function findMissingEmojiNames(
  texts: Iterable<string>,
  map: EmojiMap | null,
): string[] {
  const missing = new Set<string>();
  for (const text of texts) {
    const names = extractEmojiNames(text);
    names.forEach((name) => {
      if (!map || !map.has(name)) {
        missing.add(name);
      }
    });
  }
  return Array.from(missing);
}

export function getCachedEmojiMap(): EmojiMap | null {
  return loadEmojiCache();
}

function hasMissingEmojis(map: EmojiMap | null, names: string[]): boolean {
  if (names.length === 0) {
    return map === null;
  }
  if (!map) {
    return true;
  }
  return names.some((name) => !map.has(name));
}

export async function ensureEmojiMap(
  signal?: AbortSignal,
  missingNames: string[] = [],
): Promise<EmojiMap | null> {
  const cached = loadEmojiCache();
  const shouldFetch = hasMissingEmojis(cached, missingNames);
  if (!shouldFetch && cached) {
    return cached;
  }
  if (emojiPromise) {
    return emojiPromise;
  }
  const fetchPromise = (async () => {
    const map = await fetchEmojiMap(signal);
    if (map && map.size > 0) {
      persistEmojiCache(map);
      return map;
    }
    return cached ?? null;
  })();
  emojiPromise = fetchPromise;
  try {
    return await fetchPromise;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    console.warn("Failed to fetch emojis:", error);
    return cached ?? null;
  } finally {
    if (emojiPromise === fetchPromise) {
      emojiPromise = null;
    }
  }
}

function buildEmojiNodes(text: string, map: EmojiMap): Node[] {
  const nodes: Node[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EMOJI_PATTERN.lastIndex = 0;
  while ((match = EMOJI_PATTERN.exec(text))) {
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(document.createTextNode(text.slice(lastIndex, start)));
    }
    const name = match[1];
    const url = map.get(name);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.width = 20;
      img.height = 20;
      img.alt = name;
      img.title = name;
      img.className = EMOJI_IMAGE_CLASS;
      nodes.push(img);
    } else {
      nodes.push(document.createTextNode(match[0]));
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(document.createTextNode(text.slice(lastIndex)));
  }
  return nodes;
}

export function applyEmojiToCustomList(map: EmojiMap): void {
  const container = document.getElementById(CUSTOM_LIST_CONTAINER_ID);
  if (!container) {
    return;
  }
  container
    .querySelectorAll<HTMLSpanElement>(`span[${EMOJI_TEXT_ATTR}]`)
    .forEach((span) => {
      const rawText = span.getAttribute(EMOJI_TEXT_ATTR);
      if (!rawText) {
        return;
      }
      if (span.getAttribute(EMOJI_RENDERED_ATTR) === rawText) {
        return;
      }
      const nodes = buildEmojiNodes(rawText, map);
      span.textContent = "";
      span.append(...nodes);
      span.setAttribute(EMOJI_RENDERED_ATTR, rawText);
    });
}
