import { GM_getValue, GM_setValue } from "$";
import { CategoryGroup, CategoryMetadataCache, TagIconCache } from "../types";

const STORAGE_KEY = "categoryGroups";
const CATEGORY_METADATA_KEY = "categoryMetadataCache";
const TAG_ICON_CACHE_KEY = "tagIconCache";

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
