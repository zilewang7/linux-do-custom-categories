import { GM_getValue, GM_setValue } from "$";
import {
  CategoryGroup,
  CategoryMetadataCache,
  CategoryPathCache,
  RequestControlSettings,
  TagIconCache,
} from "../types";

const STORAGE_KEY = "categoryGroups";
const CATEGORY_METADATA_KEY = "categoryMetadataCache";
const CATEGORY_PATH_KEY = "categoryPathCache";
const TAG_ICON_CACHE_KEY = "tagIconCache";
const REQUEST_CONTROL_KEY = "requestControlSettings";
export const DEFAULT_REQUEST_CONTROL_SETTINGS: RequestControlSettings = {
  concurrency: 5,
  requestDelayMs: 200,
  maxRetryAttempts: 3,
};

function normalizeInteger(value: unknown, fallback: number, minValue: number): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(minValue, Math.round(numeric));
}

function normalizeRequestControlSettings(
  input: RequestControlSettings | null
): RequestControlSettings {
  const base = input ?? DEFAULT_REQUEST_CONTROL_SETTINGS;
  return {
    concurrency: normalizeInteger(
      base.concurrency,
      DEFAULT_REQUEST_CONTROL_SETTINGS.concurrency,
      1
    ),
    requestDelayMs: normalizeInteger(
      base.requestDelayMs,
      DEFAULT_REQUEST_CONTROL_SETTINGS.requestDelayMs,
      0
    ),
    maxRetryAttempts: normalizeInteger(
      base.maxRetryAttempts,
      DEFAULT_REQUEST_CONTROL_SETTINGS.maxRetryAttempts,
      -1
    ),
  };
}

export function getCategoryGroups(): CategoryGroup[] {
  return GM_getValue<CategoryGroup[]>(STORAGE_KEY, []);
}

export function saveCategoryGroups(groups: CategoryGroup[]): void {
  GM_setValue(STORAGE_KEY, groups);
}

export function addCategoryGroup(group: CategoryGroup): void {
  const groups = getCategoryGroups();
  groups.push(group);
  saveCategoryGroups(groups);
}

export function updateCategoryGroup(group: CategoryGroup): void {
  const groups = getCategoryGroups();
  const index = groups.findIndex((g) => g.id === group.id);
  if (index !== -1) {
    groups[index] = group;
    saveCategoryGroups(groups);
  }
}

export function deleteCategoryGroup(id: string): void {
  const groups = getCategoryGroups().filter((g) => g.id !== id);
  saveCategoryGroups(groups);
}

export function getCategoryMetadataCache(): CategoryMetadataCache | null {
  return GM_getValue<CategoryMetadataCache | null>(CATEGORY_METADATA_KEY, null);
}

export function saveCategoryMetadataCache(cache: CategoryMetadataCache): void {
  GM_setValue(CATEGORY_METADATA_KEY, cache);
}

export function getTagIconCache(): TagIconCache | null {
  return GM_getValue<TagIconCache | null>(TAG_ICON_CACHE_KEY, null);
}

export function saveTagIconCache(cache: TagIconCache): void {
  GM_setValue(TAG_ICON_CACHE_KEY, cache);
}

export function getCategoryPathCache(): CategoryPathCache | null {
  return GM_getValue<CategoryPathCache | null>(CATEGORY_PATH_KEY, null);
}

export function saveCategoryPathCache(cache: CategoryPathCache): void {
  GM_setValue(CATEGORY_PATH_KEY, cache);
}

export function getRequestControlSettings(): RequestControlSettings {
  const stored = GM_getValue<RequestControlSettings | null>(REQUEST_CONTROL_KEY, null);
  return normalizeRequestControlSettings(stored);
}

export function saveRequestControlSettings(settings: RequestControlSettings): RequestControlSettings {
  const normalized = normalizeRequestControlSettings(settings);
  GM_setValue(REQUEST_CONTROL_KEY, normalized);
  return normalized;
}

export function resetRequestControlSettings(): void {
  GM_setValue(REQUEST_CONTROL_KEY, DEFAULT_REQUEST_CONTROL_SETTINGS);
}
