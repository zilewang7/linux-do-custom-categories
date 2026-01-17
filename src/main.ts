import { CategoryGroup, MergedTopicData } from "./types";
import { fetchMergedTopics, scheduleCategoryMetadataPrefetch } from "./api/discourse";
import { scheduleTagIconPrefetch } from "./ui/tagIcons";
import {
  clearActiveCustomGroup,
  injectSidebar,
  refreshSidebar,
  setActiveCustomGroup,
} from "./ui/sidebar";
import {
  hideLoading,
  isCustomListViewActive,
  renderTopicList,
  setCustomListViewActive,
  showLoading,
} from "./ui/topicList";
import { initModalObserver } from "./ui/configPanel";
import { getCategoryGroups } from "./config/storage";
import { waitForElement } from "./utils/dom";

let currentGroup: CategoryGroup | null = null;
let currentData: MergedTopicData | null = null;
let isLoading = false;
let activeRequestController: AbortController | null = null;
let activeRequestId: number | null = null;
let requestCounter = 0;
let activeCustomUrl: string | null = null;
let previousCategoryHref: string | null = null;
const CATEGORY_LIST_SELECTOR = "#sidebar-section-content-categories";
const CATEGORY_LINK_SELECTOR = "a.sidebar-section-link";
const CUSTOM_GROUP_ATTR = "data-custom-group-id";
const CUSTOM_LISTENER_ATTR = "data-custom-category-listener";
const CUSTOM_URL_PREFIX = "/custom-c/";
const TOPIC_LIST_SELECTOR = ".topic-list";
const PENDING_CUSTOM_GROUP_KEY = "custom-category-pending-group";

function buildCustomUrl(name: string): string {
  const encodedName = encodeURIComponent(name.trim());
  return `${window.location.origin}/custom-c/${encodedName}`;
}

function updateUrlToCustom(name: string): void {
  const targetUrl = buildCustomUrl(name);
  activeCustomUrl = targetUrl;
  if (window.location.href === targetUrl) {
    return;
  }
  window.history.replaceState(window.history.state, document.title, targetUrl);
}

function navigateWithHistory(url: string): void {
  const targetUrl = new URL(url, window.location.origin);
  const intermediateUrl = new URL("/", window.location.origin);
  const fallbackUrl = new URL("/latest", window.location.origin);
  const hopUrl =
    intermediateUrl.href === targetUrl.href ? fallbackUrl : intermediateUrl;

  window.history.pushState(window.history.state, document.title, hopUrl.href);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  window.setTimeout(() => {
    window.history.pushState(window.history.state, document.title, targetUrl.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, 0);
}

function getCustomGroupNameFromPath(pathname: string): string | null {
  if (!pathname.startsWith(CUSTOM_URL_PREFIX)) {
    return null;
  }
  const rawName = pathname.slice(CUSTOM_URL_PREFIX.length);
  if (!rawName) {
    return null;
  }
  try {
    const decodedName = decodeURIComponent(rawName);
    const trimmedName = decodedName.trim();
    return trimmedName.length > 0 ? trimmedName : null;
  } catch (error) {
    return null;
  }
}

function findCustomGroupByName(name: string): CategoryGroup | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }
  const groups = getCategoryGroups();
  const match = groups.find((group) => group.name.trim() === trimmedName);
  return match ?? null;
}

function storePendingCustomGroup(name: string): boolean {
  try {
    window.sessionStorage.setItem(PENDING_CUSTOM_GROUP_KEY, name);
    return true;
  } catch (error) {
    return false;
  }
}

function consumePendingCustomGroup(): string | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_CUSTOM_GROUP_KEY);
    if (!value) {
      return null;
    }
    window.sessionStorage.removeItem(PENDING_CUSTOM_GROUP_KEY);
    return value;
  } catch (error) {
    return null;
  }
}

function redirectFromCustomUrlIfNeeded(): boolean {
  const customName = getCustomGroupNameFromPath(window.location.pathname);
  if (!customName) {
    return false;
  }
  if (isCustomListViewActive()) {
    return false;
  }
  const group = findCustomGroupByName(customName);
  if (!group) {
    return false;
  }
  if (!storePendingCustomGroup(group.name)) {
    return false;
  }
  window.location.replace(`${window.location.origin}/`);
  return true;
}

async function restoreCustomGroupFromPending(): Promise<void> {
  const pendingName = consumePendingCustomGroup();
  if (!pendingName) {
    return;
  }
  if (isCustomListViewActive()) {
    return;
  }
  const group = findCustomGroupByName(pendingName);
  if (!group) {
    return;
  }
  try {
    await waitForElement<HTMLTableElement>(TOPIC_LIST_SELECTOR);
  } catch (error) {
    console.warn("Timeout waiting for topic list, skip restore:", error);
    return;
  }
  await handleGroupClick(group);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function startRequest(): { controller: AbortController; requestId: number } {
  if (activeRequestController) {
    activeRequestController.abort();
  }
  const controller = new AbortController();
  activeRequestController = controller;
  const requestId = requestCounter + 1;
  requestCounter = requestId;
  activeRequestId = requestId;
  isLoading = true;
  return { controller, requestId };
}

function finishRequest(requestId: number): void {
  if (activeRequestId !== requestId) {
    return;
  }
  hideLoading();
  isLoading = false;
  activeRequestController = null;
}

function cancelActiveOperation(): void {
  if (activeRequestController) {
    activeRequestController.abort();
  }
  activeRequestController = null;
  activeRequestId = null;
  isLoading = false;
  currentGroup = null;
  currentData = null;
  activeCustomUrl = null;
  previousCategoryHref = null;
  clearActiveCustomGroup();
  setCustomListViewActive(false);
  hideLoading();
}

function handleLocationChange(): void {
  if (redirectFromCustomUrlIfNeeded()) {
    return;
  }
  if (!activeCustomUrl) {
    return;
  }
  if (window.location.href !== activeCustomUrl) {
    cancelActiveOperation();
  }
}

function initLocationObserver(): void {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  const wrapHistoryMethod = (
    method: History["pushState"]
  ): History["pushState"] => {
    return (...args: Parameters<History["pushState"]>) => {
      method(...args);
      handleLocationChange();
    };
  };
  history.pushState = wrapHistoryMethod(originalPushState);
  history.replaceState = wrapHistoryMethod(originalReplaceState);
  window.addEventListener("popstate", handleLocationChange);
  window.addEventListener("hashchange", handleLocationChange);
}

async function handleGroupClick(group: CategoryGroup): Promise<void> {
  if (!document.querySelector(TOPIC_LIST_SELECTOR)) {
    storePendingCustomGroup(group.name);
    window.location.replace(`${window.location.origin}/`);
    return;
  }
  const { controller, requestId } = startRequest();
  currentGroup = group;
  previousCategoryHref = getActiveCategoryHref();
  setActiveCustomGroup(group.id);
  setCustomListViewActive(true);
  updateUrlToCustom(group.name);

  showLoading();
  try {
    const data = await fetchMergedTopics(group.categoryIds, new Map(), controller.signal);
    if (activeRequestId !== requestId || controller.signal.aborted) {
      return;
    }
    currentData = data;
    renderTopicList(data);
  } catch (error) {
    if (!isAbortError(error)) {
      console.error("Failed to fetch topics:", error);
    }
  } finally {
    finishRequest(requestId);
  }
}

async function loadMore(): Promise<void> {
  if (!currentGroup || !currentData || !currentData.hasMore || isLoading) return;
  const { controller, requestId } = startRequest();

  showLoading();
  try {
    const data = await fetchMergedTopics(
      currentGroup.categoryIds,
      currentData.pageOffsets,
      controller.signal
    );
    if (activeRequestId !== requestId || controller.signal.aborted) {
      return;
    }
    currentData.topics.push(...data.topics);
    data.users.forEach((u, id) => currentData!.users.set(id, u));
    data.categories.forEach((category, id) => currentData!.categories.set(id, category));
    currentData.hasMore = data.hasMore;
    currentData.pageOffsets = data.pageOffsets;
    data.categories = currentData.categories;
    renderTopicList(data, true);
  } catch (error) {
    if (!isAbortError(error)) {
      console.error("Failed to load more:", error);
    }
  } finally {
    finishRequest(requestId);
  }
}

function handleScroll(): void {
  if (!currentGroup || !currentData?.hasMore) return;
  const scrollBottom = window.innerHeight + window.scrollY;
  const docHeight = document.documentElement.scrollHeight;
  if (docHeight - scrollBottom < 500) {
    loadMore();
  }
}

function getActiveCategoryHref(): string | null {
  const activeLink = document.querySelector<HTMLAnchorElement>(
    `${CATEGORY_LIST_SELECTOR} a.sidebar-section-link.active:not([${CUSTOM_GROUP_ATTR}])`
  );
  return activeLink?.href ?? null;
}

function initCategoryClickListener(): void {
  const body = document.body;
  if (!body || body.getAttribute(CUSTOM_LISTENER_ATTR) === "true") {
    return;
  }
  body.setAttribute(CUSTOM_LISTENER_ATTR, "true");
  body.addEventListener(
    "click",
    (event) => {
      if (!activeCustomUrl) {
        return;
      }
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (!target) {
        return;
      }
      const link = target.closest<HTMLAnchorElement>(CATEGORY_LINK_SELECTOR);
      if (!link || link.getAttribute(CUSTOM_GROUP_ATTR)) {
        return;
      }
      if (!link.closest(CATEGORY_LIST_SELECTOR)) {
        return;
      }
      const shouldForceReload =
        previousCategoryHref !== null && link.href === previousCategoryHref;
      cancelActiveOperation();
      if (shouldForceReload) {
        event.preventDefault();
        event.stopPropagation();
        navigateWithHistory(link.href);
      }
    },
    true
  );
}

function handleRefresh(): void {
  refreshSidebar(handleGroupClick);
}

async function init(): Promise<void> {
  if (redirectFromCustomUrlIfNeeded()) {
    return;
  }
  await injectSidebar(handleGroupClick);
  initModalObserver(handleRefresh);
  initLocationObserver();
  initCategoryClickListener();
  window.addEventListener("scroll", handleScroll);
  scheduleCategoryMetadataPrefetch();
  scheduleTagIconPrefetch();
  void restoreCustomGroupFromPending();

  // re-inject on Ember route changes
  const observer = new MutationObserver(() => {
    const list = document.querySelector("#sidebar-section-content-categories");
    const hasCustomGroups = getCategoryGroups().length > 0;
    if (list instanceof HTMLUListElement && hasCustomGroups) {
      const hasCustomItems = list.querySelector("[data-custom-group-id]");
      if (!hasCustomItems) {
        refreshSidebar(handleGroupClick);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

init();
