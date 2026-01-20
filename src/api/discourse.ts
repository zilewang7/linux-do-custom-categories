import { CategoryInfo, CategoryResponse, MergedTopicData, Topic, User } from "../types";
import {
  getCategoryMetadataCache,
  getCategoryPathCache,
  getRequestControlSettings,
  saveCategoryMetadataCache,
  saveCategoryPathCache,
} from "../config/storage";
import { startFetchProgress } from "../ui/fetchProgress";

const RETRY_BASE_DELAY_MS = 600;
const HIERARCHICAL_CATEGORY_ENDPOINT =
  "https://linux.do/categories/hierarchical_search?term=";
const HIERARCHICAL_CATEGORY_BATCH_SIZE = 4;
const CATEGORY_PREFETCH_DELAY_MS = 3000;
const UTC_MINUS_8_OFFSET_MS = -8 * 60 * 60 * 1000;
const REFRESH_HOUR_UTC_MINUS_8 = 4;
let hierarchicalCategoryCache: Map<number, CategoryInfo> | null = null;
let hierarchicalCategoryPromise: Promise<Map<number, CategoryInfo>> | null = null;
let hierarchicalCategoryCacheUpdatedAt: number | null = null;
let prefetchTimeoutId: number | null = null;
const categoryPathCache = new Map<number, string>();
let categoryPathCacheLoaded = false;

function createAbortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timerId = window.setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timerId);
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      reject(createAbortError());
    };
    if (signal) {
      signal.addEventListener("abort", handleAbort, { once: true });
    }
  });
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 403;
}

function canRetry(attempt: number, maxRetryAttempts: number): boolean {
  return maxRetryAttempts < 0 || attempt < maxRetryAttempts;
}

function getCsrfToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return meta?.content ?? null;
}

function buildCategoryMap(categories: CategoryInfo[]): Map<number, CategoryInfo> {
  const map = new Map<number, CategoryInfo>();
  categories.forEach((category) => {
    map.set(category.id, category);
  });
  return map;
}

function loadCategoryPathCache(): void {
  if (categoryPathCacheLoaded) {
    return;
  }
  categoryPathCacheLoaded = true;
  const stored = getCategoryPathCache();
  if (!stored || typeof stored.updatedAt !== "number" || !stored.paths) {
    return;
  }
  Object.entries(stored.paths).forEach(([key, value]) => {
    const id = Number(key);
    if (Number.isFinite(id) && value) {
      categoryPathCache.set(id, value);
    }
  });
}

function persistCategoryPathCache(): void {
  const paths: Record<string, string> = {};
  categoryPathCache.forEach((value, key) => {
    paths[String(key)] = value;
  });
  const updatedAt = Date.now();
  saveCategoryPathCache({ updatedAt, paths });
}

function extractCategoryBasePath(url: string, categoryId: number): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname;
    if (!path.startsWith("/c/")) {
      return null;
    }
    const match = path.match(/\/(\d+)(?:\.json)?$/);
    if (!match) {
      return null;
    }
    if (Number(match[1]) !== categoryId) {
      return null;
    }
    return path.replace(/\.json$/, "");
  } catch (error) {
    return null;
  }
}

function updateCategoryPathCache(categoryId: number, url: string): void {
  const resolvedPath = extractCategoryBasePath(url, categoryId);
  if (!resolvedPath) {
    return;
  }
  const current = categoryPathCache.get(categoryId);
  if (current !== resolvedPath) {
    categoryPathCache.set(categoryId, resolvedPath);
    persistCategoryPathCache();
  }
}

function buildCategoryTopicsUrl(categoryId: number, page: number): string {
  loadCategoryPathCache();
  const cachedPath = categoryPathCache.get(categoryId);
  const basePath = cachedPath ?? `/c/${categoryId}`;
  const suffix = page === 0 ? "" : `?page=${page}`;
  return `${window.location.origin}${basePath}.json${suffix}`;
}

function loadCategoryMetadataCache(): {
  map: Map<number, CategoryInfo> | null;
  updatedAt: number | null;
} {
  if (hierarchicalCategoryCache) {
    return {
      map: hierarchicalCategoryCache,
      updatedAt: hierarchicalCategoryCacheUpdatedAt,
    };
  }
  const cached = getCategoryMetadataCache();
  if (
    !cached ||
    !Array.isArray(cached.categories) ||
    typeof cached.updatedAt !== "number"
  ) {
    return { map: null, updatedAt: null };
  }
  const map = buildCategoryMap(cached.categories);
  hierarchicalCategoryCache = map;
  hierarchicalCategoryCacheUpdatedAt = cached.updatedAt;
  return { map, updatedAt: cached.updatedAt };
}

function persistCategoryMetadataCache(
  map: Map<number, CategoryInfo>,
  updatedAt: number
): void {
  hierarchicalCategoryCache = map;
  hierarchicalCategoryCacheUpdatedAt = updatedAt;
  saveCategoryMetadataCache({
    updatedAt,
    categories: Array.from(map.values()),
  });
}

function getUtcMinus8StartOfDay(dateMs: number): number {
  const shifted = new Date(dateMs + UTC_MINUS_8_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return Date.UTC(year, month, day) - UTC_MINUS_8_OFFSET_MS;
}

function getLatestRefreshTimestamp(nowMs: number): number {
  const startOfDay = getUtcMinus8StartOfDay(nowMs);
  const refreshTime =
    startOfDay + REFRESH_HOUR_UTC_MINUS_8 * 60 * 60 * 1000;
  if (nowMs >= refreshTime) {
    return refreshTime;
  }
  return refreshTime - 24 * 60 * 60 * 1000;
}

function shouldRefreshCategoryMetadata(updatedAt: number, nowMs: number): boolean {
  if (!Number.isFinite(updatedAt)) {
    return true;
  }
  const latestRefresh = getLatestRefreshTimestamp(nowMs);
  return updatedAt < latestRefresh;
}

function hasMissingCategories(
  cachedMap: Map<number, CategoryInfo> | null,
  missingCategoryIds?: number[]
): boolean {
  if (!missingCategoryIds || missingCategoryIds.length === 0) {
    return false;
  }
  if (!cachedMap) {
    return true;
  }
  return missingCategoryIds.some((id) => !cachedMap.has(id));
}

function collectMissingCategoryIds(
  topics: Topic[],
  categories: Map<number, CategoryInfo>,
  cachedMap: Map<number, CategoryInfo> | null
): number[] {
  const missing = new Set<number>();
  const check = (id: number | null | undefined) => {
    if (typeof id !== "number") {
      return;
    }
    if (!cachedMap || !cachedMap.has(id)) {
      missing.add(id);
    }
  };
  topics.forEach((topic) => {
    check(topic.category_id);
    const category = categories.get(topic.category_id);
    if (category?.parent_category_id !== undefined) {
      check(category.parent_category_id ?? null);
    }
  });
  return Array.from(missing);
}

function mergeCategoryInfo(
  base: CategoryInfo | undefined,
  incoming: CategoryInfo
): CategoryInfo {
  if (!base) {
    return incoming;
  }
  return {
    id: base.id,
    name: incoming.name ?? base.name,
    slug: incoming.slug ?? base.slug,
    color: incoming.color ?? base.color,
    text_color: incoming.text_color ?? base.text_color,
    style_type: incoming.style_type ?? base.style_type,
    icon: incoming.icon ?? base.icon,
    emoji: incoming.emoji ?? base.emoji,
    parent_category_id: incoming.parent_category_id ?? base.parent_category_id,
    read_restricted: incoming.read_restricted ?? base.read_restricted,
    description: incoming.description ?? base.description,
    description_text: incoming.description_text ?? base.description_text,
  };
}

async function fetchHierarchicalCategoryPage(
  page: number,
  signal?: AbortSignal,
  maxRetryAttempts = getRequestControlSettings().maxRetryAttempts
): Promise<CategoryInfo[]> {
  const url = `${HIERARCHICAL_CATEGORY_ENDPOINT}&page=${page}`;
  const headers: Record<string, string> = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    try {
      const response = await fetch(url, {
        signal,
        headers,
        credentials: "same-origin",
      });
      if (response.ok) {
        const data: { categories?: CategoryInfo[] } = await response.json();
        return data.categories ?? [];
      }
      if (!isRetryableStatus(response.status) || !canRetry(attempt, maxRetryAttempts)) {
        console.warn(`Failed to fetch hierarchical categories: ${response.status}`);
        return [];
      }
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      const backoffMs =
        retryAfter ?? RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      attempt += 1;
      await delay(backoffMs, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (!canRetry(attempt, maxRetryAttempts)) {
        console.warn("Failed to fetch hierarchical categories:", error);
        return [];
      }
      const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      attempt += 1;
      await delay(backoffMs, signal);
    }
  }
}

type HierarchyFetchOptions = {
  forceRefresh?: boolean;
  missingCategoryIds?: number[];
};

async function fetchHierarchicalCategories(
  signal?: AbortSignal,
  options?: HierarchyFetchOptions
): Promise<Map<number, CategoryInfo>> {
  const cached = loadCategoryMetadataCache();
  const maxRetryAttempts = getRequestControlSettings().maxRetryAttempts;
  const nowMs = Date.now();
  const hasCache = cached.map && cached.updatedAt !== null;
  const updatedAt = cached.updatedAt ?? 0;
  const isStale = hasCache
    ? shouldRefreshCategoryMetadata(updatedAt, nowMs)
    : true;
  const needsFetch =
    options?.forceRefresh === true ||
    !hasCache ||
    isStale ||
    hasMissingCategories(cached.map, options?.missingCategoryIds);

  if (!needsFetch && cached.map) {
    return cached.map;
  }

  if (hierarchicalCategoryPromise) {
    return hierarchicalCategoryPromise;
  }

  const fetchPromise = (async () => {
    const categories = new Map<number, CategoryInfo>();
    let page = 1;
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      const pages = Array.from(
        { length: HIERARCHICAL_CATEGORY_BATCH_SIZE },
        (_, index) => page + index
      );
      const results = await Promise.all(
        pages.map((targetPage) =>
          fetchHierarchicalCategoryPage(targetPage, signal, maxRetryAttempts)
        )
      );
      let shouldStop = false;
      results.forEach((list) => {
        if (list.length === 0) {
          shouldStop = true;
          return;
        }
        list.forEach((category) => {
          categories.set(category.id, category);
        });
      });
      if (shouldStop) {
        break;
      }
      page += HIERARCHICAL_CATEGORY_BATCH_SIZE;
    }
    if (categories.size > 0) {
      persistCategoryMetadataCache(categories, Date.now());
      return categories;
    }
    return cached.map ?? categories;
  })();

  hierarchicalCategoryPromise = fetchPromise;
  try {
    return await fetchPromise;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    console.warn("Failed to fetch hierarchical categories:", error);
    return cached.map ?? new Map<number, CategoryInfo>();
  } finally {
    if (hierarchicalCategoryPromise === fetchPromise) {
      hierarchicalCategoryPromise = null;
    }
  }
}

export function scheduleCategoryMetadataPrefetch(): void {
  const schedule = () => {
    if (prefetchTimeoutId !== null) {
      return;
    }
    const cached = loadCategoryMetadataCache();
    const updatedAt = cached.updatedAt;
    const shouldFetch =
      !cached.map ||
      updatedAt === null ||
      shouldRefreshCategoryMetadata(updatedAt, Date.now());
    if (!shouldFetch) {
      return;
    }
    prefetchTimeoutId = window.setTimeout(() => {
      prefetchTimeoutId = null;
      const latestCached = loadCategoryMetadataCache();
      const latestUpdatedAt = latestCached.updatedAt;
      const shouldFetchNow =
        !latestCached.map ||
        latestUpdatedAt === null ||
        shouldRefreshCategoryMetadata(latestUpdatedAt, Date.now());
      if (!shouldFetchNow) {
        return;
      }
      fetchHierarchicalCategories(undefined, { forceRefresh: true }).catch(
        (error) => {
          if (!isAbortError(error)) {
            console.warn("Failed to prefetch category metadata:", error);
          }
        }
      );
    }, CATEGORY_PREFETCH_DELAY_MS);
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }
}

export async function fetchCategoryTopics(
  categoryId: number,
  page = 0,
  signal?: AbortSignal,
  maxRetryAttempts = getRequestControlSettings().maxRetryAttempts
): Promise<CategoryResponse | null> {
  const url = buildCategoryTopicsUrl(categoryId, page);

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    try {
      const response = await fetch(url, { signal });
      if (response.redirected) {
        updateCategoryPathCache(categoryId, response.url);
      }
      if (response.ok) {
        return response.json();
      }
      if (!isRetryableStatus(response.status) || !canRetry(attempt, maxRetryAttempts)) {
        console.warn(`Failed to fetch category ${categoryId}: ${response.status}`);
        return null;
      }
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      const backoffMs =
        retryAfter ?? RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      attempt += 1;
      await delay(backoffMs, signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (!canRetry(attempt, maxRetryAttempts)) {
        console.warn(`Failed to fetch category ${categoryId}:`, error);
        return null;
      }
      const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      attempt += 1;
      await delay(backoffMs, signal);
    }
  }
}

export async function fetchMergedTopics(
  categoryIds: number[],
  pageOffsets: Map<number, number> = new Map(),
  signal?: AbortSignal
): Promise<MergedTopicData> {
  const users = new Map<number, User>();
  const allTopics: Topic[] = [];
  let hasMore = false;
  const newOffsets = new Map(pageOffsets);
  const categories = new Map<number, CategoryInfo>();
  const cachedMetadata = loadCategoryMetadataCache();
  const requestSettings = getRequestControlSettings();
  const requestDelayMs = requestSettings.requestDelayMs;
  const maxRetryAttempts = requestSettings.maxRetryAttempts;
  const progress = startFetchProgress(categoryIds.length);

  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      const index = nextIndex;
      if (index >= categoryIds.length) {
        return;
      }
      nextIndex += 1;
      const categoryId = categoryIds[index];
      const page = pageOffsets.get(categoryId) ?? 0;
      let response: CategoryResponse | null = null;
      try {
        response = await fetchCategoryTopics(categoryId, page, signal, maxRetryAttempts);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        console.warn(`Failed to fetch category ${categoryId}:`, error);
      }
      if (response) {
        response.users.forEach((u) => users.set(u.id, u));
        allTopics.push(...response.topic_list.topics);
        if (response.category) {
          categories.set(
            response.category.id,
            mergeCategoryInfo(categories.get(response.category.id), response.category)
          );
        }
        if (response.category_list?.categories) {
          response.category_list.categories.forEach((category) => {
            categories.set(
              category.id,
              mergeCategoryInfo(categories.get(category.id), category)
            );
          });
        }
        if (response.topic_list.more_topics_url) {
          hasMore = true;
          newOffsets.set(categoryId, page + 1);
        }
        progress.markSuccess();
      } else {
        progress.markFailure();
      }
      if (requestDelayMs > 0) {
        await delay(requestDelayMs, signal);
      }
    }
  };

  const concurrency = Math.min(requestSettings.concurrency, categoryIds.length);
  const workers = Array.from({ length: concurrency }, () => worker());
  try {
    await Promise.all(workers);
  } catch (error) {
    if (isAbortError(error)) {
      progress.finish({ aborted: true });
      throw error;
    }
    progress.finish();
    throw error;
  }
  progress.finish();

  if (cachedMetadata.map) {
    cachedMetadata.map.forEach((category, id) => {
      categories.set(id, mergeCategoryInfo(categories.get(id), category));
    });
  }

  const missingCategoryIds = collectMissingCategoryIds(
    allTopics,
    categories,
    cachedMetadata.map
  );
  const shouldRefresh =
    cachedMetadata.updatedAt === null ||
    (cachedMetadata.updatedAt !== null &&
      shouldRefreshCategoryMetadata(cachedMetadata.updatedAt, Date.now()));
  const shouldFetchHierarchy =
    !cachedMetadata.map || shouldRefresh || missingCategoryIds.length > 0;
  if (shouldFetchHierarchy) {
    const hierarchyCategories = await fetchHierarchicalCategories(signal, {
      forceRefresh: shouldRefresh || !cachedMetadata.map,
      missingCategoryIds,
    });
    hierarchyCategories.forEach((category, id) => {
      categories.set(id, mergeCategoryInfo(categories.get(id), category));
    });
  }

  // sort by bumped_at desc, dedupe by id
  const seen = new Set<number>();
  const topics = allTopics
    .sort((a, b) => new Date(b.bumped_at).getTime() - new Date(a.bumped_at).getTime())
    .filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

  return { topics, users, hasMore, pageOffsets: newOffsets, categories };
}
