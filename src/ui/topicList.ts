import { CategoryInfo, MergedTopicData, Topic, TopicPoster, User } from "../types";
import { ensureTagIconMap, getCachedTagIconMap, TagIconData, TagIconMap } from "./tagIcons";
import { createEl } from "../utils/dom";

const LOADING_INDICATOR_SELECTOR = ".loading-indicator-container";
const LOADING_STATE_CLASSES = ["ready", "loading", "done"];
const LOADING_READY_DELAY_MS = 400;
let readyTimeoutId: number | null = null;
const CUSTOM_VIEW_CLASS = "custom-category-view-active";
const CUSTOM_VIEW_STYLE_ID = "custom-category-view-style";
const LIST_CONTROLS_SELECTOR = ".list-controls";
const HEADER_LIST_ID = "header-list-area";
const SHOW_MORE_SELECTOR = ".contents .show-more.has-topics";
const LIST_AREA_SELECTOR = "#list-area";
const CONTENTS_SELECTOR = "#list-area .contents";
const CUSTOM_LIST_CONTAINER_ID = "custom-topic-list-container";
const CUSTOM_LIST_CONTAINER_CLASS = "custom-topic-list-container";
const CUSTOM_LIST_BODY_ID = "custom-topic-list-body";
const CATEGORY_LIST_SELECTOR = "#sidebar-section-content-categories";
const ACTIVE_CATEGORY_SELECTOR =
  `${CATEGORY_LIST_SELECTOR} a.sidebar-section-link.active:not([data-custom-group-id])`;
let customViewObserver: MutationObserver | null = null;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CATEGORY_ICON_CACHE = new Map<number, string | null>();
type CategoryVisual =
  | { type: "icon"; value: string }
  | { type: "emoji"; value: string };
let isTagIconFetchPending = false;
type HeatSettings = {
  topicViews: { low: number; medium: number; high: number };
  topicPostLike: { low: number; medium: number; high: number };
};
let heatSettingsCache: HeatSettings | null = null;

function getLoadingIndicator(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>(LOADING_INDICATOR_SELECTOR);
}

function setLoadingState(state: "ready" | "loading" | "done"): void {
  const indicator = getLoadingIndicator();
  if (!indicator) {
    return;
  }
  LOADING_STATE_CLASSES.forEach((value) => indicator.classList.remove(value));
  indicator.classList.add(state);
}

function clearReadyTimeout(): void {
  if (readyTimeoutId === null) {
    return;
  }
  window.clearTimeout(readyTimeoutId);
  readyTimeoutId = null;
}

function ensureCustomViewStyles(): void {
  if (document.getElementById(CUSTOM_VIEW_STYLE_ID)) {
    return;
  }
  const styles = `
    #${CUSTOM_LIST_CONTAINER_ID} {
      display: none;
    }

    .${CUSTOM_VIEW_CLASS} #${CUSTOM_LIST_CONTAINER_ID} {
      display: block;
    }

    .${CUSTOM_VIEW_CLASS} ${CONTENTS_SELECTOR} {
      display: none !important;
    }

    .${CUSTOM_VIEW_CLASS} ${LIST_CONTROLS_SELECTOR},
    .${CUSTOM_VIEW_CLASS} #${HEADER_LIST_ID},
    .${CUSTOM_VIEW_CLASS} ${SHOW_MORE_SELECTOR} {
      display: none !important;
    }
  `;
  const styleEl = createEl("style", { id: CUSTOM_VIEW_STYLE_ID }, [styles]);
  document.head.appendChild(styleEl);
}

function clearActiveCategorySelection(): void {
  document
    .querySelectorAll<HTMLAnchorElement>(ACTIVE_CATEGORY_SELECTOR)
    .forEach((link) => {
      link.classList.remove("active");
      link.removeAttribute("aria-current");
    });
}

function cloneTopicListHeader(): HTMLTableSectionElement | null {
  const existingHeader = document.querySelector(".topic-list thead");
  if (!(existingHeader instanceof HTMLTableSectionElement)) {
    return null;
  }
  const cloned = existingHeader.cloneNode(true);
  if (cloned instanceof HTMLTableSectionElement) {
    return cloned;
  }
  return null;
}

function cloneTopicListCaption(): HTMLTableCaptionElement | null {
  const existingCaption = document.querySelector(".topic-list caption");
  if (!(existingCaption instanceof HTMLTableCaptionElement)) {
    return null;
  }
  const cloned = existingCaption.cloneNode(true);
  if (cloned instanceof HTMLTableCaptionElement) {
    return cloned;
  }
  return null;
}

function getTopicListTableAttributes(): Record<string, string> {
  const table = document.querySelector<HTMLTableElement>(".topic-list");
  const attrs: Record<string, string> = {};
  if (table?.className) {
    attrs.class = table.className;
  } else {
    attrs.class = "topic-list";
  }
  const ariaLabelledBy = table?.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    attrs["aria-labelledby"] = ariaLabelledBy;
  }
  return attrs;
}

function ensureCustomListContainer(): HTMLDivElement | null {
  const existing = document.getElementById(CUSTOM_LIST_CONTAINER_ID);
  const listArea = document.querySelector<HTMLDivElement>(LIST_AREA_SELECTOR);
  if (existing) {
    if (!(existing instanceof HTMLDivElement)) {
      return null;
    }
    if (!listArea) {
      return existing.isConnected ? existing : null;
    }
    if (listArea.contains(existing)) {
      return existing;
    }
    try {
      listArea.appendChild(existing);
    } catch (error) {
      console.warn("Failed to reattach custom list container:", error);
    }
    return existing;
  }

  if (!listArea) {
    return null;
  }

  const container = createEl("div", {
    id: CUSTOM_LIST_CONTAINER_ID,
    class: CUSTOM_LIST_CONTAINER_CLASS,
  });
  const table = createEl("table", getTopicListTableAttributes());
  const caption = cloneTopicListCaption();
  if (caption) {
    table.appendChild(caption);
  }
  const header = cloneTopicListHeader();
  if (header) {
    table.appendChild(header);
  }
  const tbody = createEl("tbody", {
    id: CUSTOM_LIST_BODY_ID,
    class: "topic-list-body",
  });
  table.appendChild(tbody);
  container.appendChild(table);

  try {
    listArea.appendChild(container);
  } catch (error) {
    console.warn("Failed to insert custom list container:", error);
  }

  return container;
}

export function setCustomListViewActive(active: boolean): void {
  ensureCustomViewStyles();
  const body = document.body;
  if (!body) {
    return;
  }

  if (active) {
    body.classList.add(CUSTOM_VIEW_CLASS);
    ensureCustomListContainer();
    clearActiveCategorySelection();
    if (!customViewObserver) {
      customViewObserver = new MutationObserver(() => {
        clearActiveCategorySelection();
        if (!document.getElementById(CUSTOM_LIST_CONTAINER_ID)) {
          ensureCustomListContainer();
        }
      });
      customViewObserver.observe(body, { childList: true, subtree: true });
    }
  } else {
    body.classList.remove(CUSTOM_VIEW_CLASS);
    if (customViewObserver) {
      customViewObserver.disconnect();
      customViewObserver = null;
    }
  }
}

export function isCustomListViewActive(): boolean {
  return document.body?.classList.contains(CUSTOM_VIEW_CLASS) ?? false;
}

function stripHtml(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent?.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSiteSettingsRecord(): Record<string, unknown> {
  const win = window as unknown as Record<string, unknown>;
  const maybeDiscourse = win["Discourse"];
  if (isRecord(maybeDiscourse)) {
    const siteSettings = maybeDiscourse["SiteSettings"];
    if (isRecord(siteSettings)) {
      return siteSettings;
    }
  }
  const maybeSettings = win["siteSettings"];
  if (isRecord(maybeSettings)) {
    return maybeSettings;
  }
  return {};
}

function parseNumberSetting(
  settings: Record<string, unknown>,
  key: string
): number | null {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getHeatSettings(): HeatSettings | null {
  const settings = getSiteSettingsRecord();
  if (heatSettingsCache) {
    return heatSettingsCache;
  }
  const viewsLow = parseNumberSetting(settings, "topic_views_heat_low");
  const viewsMedium = parseNumberSetting(settings, "topic_views_heat_medium");
  const viewsHigh = parseNumberSetting(settings, "topic_views_heat_high");
  const likeLow = parseNumberSetting(settings, "topic_post_like_heat_low");
  const likeMedium = parseNumberSetting(settings, "topic_post_like_heat_medium");
  const likeHigh = parseNumberSetting(settings, "topic_post_like_heat_high");
  if (
    viewsLow === null ||
    viewsMedium === null ||
    viewsHigh === null ||
    likeLow === null ||
    likeMedium === null ||
    likeHigh === null
  ) {
    return null;
  }
  const resolved: HeatSettings = {
    topicViews: {
      low: viewsLow,
      medium: viewsMedium,
      high: viewsHigh,
    },
    topicPostLike: {
      low: likeLow,
      medium: likeMedium,
      high: likeHigh,
    },
  };
  heatSettingsCache = resolved;
  return resolved;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatDateTimeTitle(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year} 年 ${month}月 ${day} 日 ${hours}:${minutes}`;
}

function buildActivityTitle(
  createdAt?: string,
  lastPostedAt?: string,
  bumpedAt?: string
): string | null {
  const lines: string[] = [];
  if (createdAt) {
    lines.push(`创建日期：${formatDateTimeTitle(createdAt)}`);
  }
  const latest = lastPostedAt ?? bumpedAt;
  if (latest) {
    lines.push(`最新：${formatDateTimeTitle(latest)}`);
  }
  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n");
}

function formatRelativeTimeTiny(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs)) {
    return "";
  }
  if (diffMs < 60000) {
    return "刚刚";
  }
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} 月`;
  }
  const years = Math.floor(months / 12);
  return `${years} 年`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function normalizeColor(color?: string | null): string | null {
  if (!color) {
    return null;
  }
  return color.startsWith("#") ? color : `#${color}`;
}

function buildCategoryStyle(
  category: CategoryInfo,
  parentCategory?: CategoryInfo
): string | null {
  const styleParts: string[] = [];
  const color = normalizeColor(category.color);
  const textColor = normalizeColor(category.text_color);
  if (color) {
    styleParts.push(`--category-badge-color: ${color};`);
  }
  if (textColor) {
    styleParts.push(`--category-badge-text-color: ${textColor};`);
  }
  if (parentCategory) {
    const parentColor = normalizeColor(parentCategory.color);
    const parentTextColor = normalizeColor(parentCategory.text_color);
    if (parentColor) {
      styleParts.push(`--parent-category-badge-color: ${parentColor};`);
    }
    if (parentTextColor) {
      styleParts.push(`--parent-category-badge-text-color: ${parentTextColor};`);
    }
  }
  return styleParts.length > 0 ? styleParts.join("") : null;
}

function buildCategoryHref(
  category: CategoryInfo,
  parentCategory?: CategoryInfo
): string {
  if (parentCategory) {
    return `/c/${parentCategory.slug}/${category.slug}/${category.id}`;
  }
  return `/c/${category.slug}/${category.id}`;
}

function getCategoryDisplayName(
  category: CategoryInfo
): string {
  return category.name;
}

function normalizeTagClass(tag: string): string {
  return tag.trim().replace(/\s+/g, "-");
}

function buildCategoryRowClass(
  category?: CategoryInfo,
  parentCategory?: CategoryInfo
): string | null {
  if (!category) {
    return null;
  }
  if (parentCategory) {
    return `category-${parentCategory.slug}-${category.slug}`;
  }
  return `category-${category.slug}`;
}

function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function buildTopicRowClass(
  topic: Topic,
  category?: CategoryInfo,
  parentCategory?: CategoryInfo
): string {
  const classes: string[] = ["topic-list-item"];
  const categoryClass = buildCategoryRowClass(category, parentCategory);
  if (categoryClass) {
    classes.push(categoryClass);
  }
  if (topic.unseen) {
    classes.push("unseen-topic");
  }
  if (topic.pinned || topic.pinned_globally) {
    classes.push("pinned");
  }
  if (topic.has_accepted_answer) {
    classes.push("status-solved");
  }
  if (topic.excerpt) {
    classes.push("has-excerpt", "excerpt-expanded");
  }
  if (topic.tags) {
    topic.tags.forEach((tag) => {
      classes.push(`tag-${normalizeTagClass(tag)}`);
    });
  }
  return classes.join(" ");
}

function buildAvatarUrl(user: User): string {
  const template = user.avatar_template.replace("{size}", "48");
  if (template.startsWith("http")) {
    return template;
  }
  return `https://linux.do${template}`;
}

function buildIconClass(iconId: string): string {
  return `fa d-icon d-icon-${iconId} svg-icon fa-width-auto svg-string`;
}

function createSvgIcon(iconId: string, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", className ?? buildIconClass(iconId));
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `#${iconId}`);
  svg.appendChild(use);
  return svg;
}

function createEmojiIcon(emoji: string): HTMLSpanElement {
  return createEl("span", { class: "emoji", role: "img", "aria-label": emoji }, [emoji]);
}

function createTagIconSpan(tagIcon: TagIconData): HTMLSpanElement {
  const attrs: Record<string, string> = { class: "tag-icon" };
  if (tagIcon.color) {
    attrs.style = `color: ${tagIcon.color}`;
  }
  const span = createEl("span", attrs);
  span.appendChild(createSvgIcon(tagIcon.icon));
  return span;
}

function resolveCategoryIconId(category: CategoryInfo): string | null {
  if (CATEGORY_ICON_CACHE.has(category.id)) {
    return CATEGORY_ICON_CACHE.get(category.id) ?? null;
  }
  const useEl = document.querySelector(
    `[data-category-id="${category.id}"] svg use`
  );
  if (!useEl) {
    CATEGORY_ICON_CACHE.set(category.id, null);
    return null;
  }
  const href = useEl.getAttribute("href") ?? useEl.getAttribute("xlink:href");
  if (!href) {
    CATEGORY_ICON_CACHE.set(category.id, null);
    return null;
  }
  const iconId = href.startsWith("#") ? href.slice(1) : href;
  CATEGORY_ICON_CACHE.set(category.id, iconId);
  return iconId;
}

function resolveCategoryVisual(
  category: CategoryInfo,
  parentCategory?: CategoryInfo
): CategoryVisual | null {
  if (category.style_type === "emoji" && category.emoji) {
    return { type: "emoji", value: category.emoji };
  }
  if (parentCategory?.style_type === "emoji" && parentCategory.emoji) {
    return { type: "emoji", value: parentCategory.emoji };
  }
  const iconId = category.icon ?? parentCategory?.icon;
  if (iconId) {
    return { type: "icon", value: iconId };
  }
  const domIcon =
    resolveCategoryIconId(category) ??
    (parentCategory ? resolveCategoryIconId(parentCategory) : null);
  if (domIcon) {
    return { type: "icon", value: domIcon };
  }
  return null;
}

function getTopicTitle(topic: Topic): string {
  if (topic.fancy_title) {
    const title = stripHtml(topic.fancy_title);
    if (title) {
      return title;
    }
  }
  return topic.title;
}

function createPinnedStatus(topic: Topic): HTMLAnchorElement {
  const title = topic.pinned_globally
    ? "此话题已对您置顶；它将显示在所有类别的顶部"
    : "此话题已对您置顶；它将显示在所属类别的顶部";
  const link = createEl("a", {
    href: `/t/${topic.slug}/${topic.id}`,
    title,
    class: "topic-status --pinned pin-toggle-button",
  });
  link.appendChild(createSvgIcon("thumbtack"));
  return link;
}

function createStatusIcon(iconId: string, className: string, title: string): HTMLSpanElement {
  const status = createEl("span", { class: className, title });
  status.appendChild(createSvgIcon(iconId));
  return status;
}

function createTopicStatuses(topic: Topic): HTMLSpanElement {
  const statuses = createEl("span", { class: "topic-statuses" });
  if (topic.pinned || topic.pinned_globally) {
    statuses.appendChild(createPinnedStatus(topic));
  }
  if (topic.has_accepted_answer) {
    statuses.appendChild(
      createStatusIcon("far-square-check", "topic-status --solved", "此话题有解决方案")
    );
  } else if (topic.can_have_answer) {
    statuses.appendChild(
      createStatusIcon("far-square", "topic-status --unsolved", "此话题尚无解决方案")
    );
  }
  if (topic.closed) {
    statuses.appendChild(
      createStatusIcon("lock", "topic-status --closed", "此话题已关闭")
    );
  }
  if (topic.archived) {
    statuses.appendChild(
      createStatusIcon("archive", "topic-status --archived", "此话题已归档")
    );
  }
  return statuses;
}

function createTopicBadges(topic: Topic): HTMLSpanElement {
  const badges = createEl("span", { class: "topic-post-badges" });
  if (topic.unseen) {
    badges.append(" ");
    const badge = createEl("a", {
      href: `/t/${topic.slug}/${topic.id}/1`,
      title: "新话题",
      class: "badge badge-notification new-topic",
    });
    badges.appendChild(badge);
  }
  return badges;
}

function createTopicTitleLink(topic: Topic): HTMLAnchorElement {
  const titleText = getTopicTitle(topic);
  const titleSpan = createEl("span", { dir: "auto" }, [titleText]);
  return createEl(
    "a",
    {
      href: `/t/${topic.slug}/${topic.id}`,
      "data-topic-id": String(topic.id),
      class: "title raw-link raw-topic-link",
    },
    [titleSpan]
  );
}

function createTopicExcerpt(topic: Topic): HTMLAnchorElement | null {
  if (!topic.excerpt) {
    return null;
  }
  const excerptText = stripHtml(topic.excerpt);
  if (!excerptText) {
    return null;
  }
  const excerptSpan = createEl("span", { dir: "auto" }, [excerptText]);
  return createEl("a", { href: `/t/${topic.slug}/${topic.id}`, class: "topic-excerpt" }, [
    excerptSpan,
  ]);
}

function createCategoryBadge(
  category: CategoryInfo,
  categories: Map<number, CategoryInfo>
): HTMLAnchorElement {
  const parentCategory = category.parent_category_id
    ? categories.get(category.parent_category_id)
    : undefined;
  const badgeClasses: string[] = ["badge-category"];
  if (category.read_restricted) {
    badgeClasses.push("restricted");
  }
  if (parentCategory) {
    badgeClasses.push("--has-parent");
  }
  const visual = resolveCategoryVisual(category, parentCategory);
  if (visual || category.read_restricted) {
    badgeClasses.push("--style-icon");
  }
  if (visual?.type === "emoji") {
    badgeClasses.push("--style-emoji");
  }
  const titleText = category.description_text ?? category.description;
  const badgeAttrs: Record<string, string> = {
    class: badgeClasses.join(" "),
    "data-category-id": String(category.id),
    "data-drop-close": "true",
  };
  if (parentCategory) {
    badgeAttrs["data-parent-category-id"] = String(parentCategory.id);
  }
  if (titleText) {
    badgeAttrs.title = stripHtml(titleText);
  }
  const badge = createEl("span", badgeAttrs);
  if (visual?.type === "icon") {
    badge.appendChild(createSvgIcon(visual.value));
  } else if (visual?.type === "emoji") {
    badge.appendChild(createEmojiIcon(visual.value));
  }
  if (category.read_restricted) {
    badge.appendChild(createSvgIcon("lock"));
  }
  const nameSpan = createEl("span", { class: "badge-category__name", dir: "auto" }, [
    getCategoryDisplayName(category),
  ]);
  badge.appendChild(nameSpan);
  const wrapperAttrs: Record<string, string> = {
    href: buildCategoryHref(category, parentCategory),
    class: "badge-category__wrapper ",
  };
  const style = buildCategoryStyle(category, parentCategory);
  if (style) {
    wrapperAttrs.style = style;
  }
  return createEl("a", wrapperAttrs, [badge]);
}

function createTagsList(tags: string[] | undefined): HTMLDivElement | null {
  if (!tags || tags.length === 0) {
    return null;
  }
  const list = createEl("div", {
    class: "discourse-tags",
    role: "list",
    "aria-label": "标签",
  });
  tags.forEach((tag, index) => {
    if (index > 0) {
      list.appendChild(
        createEl("span", { class: "discourse-tags__tag-separator" }, [","])
      );
    }
    const tagKey = normalizeTagKey(tag);
    const tagIconMap = getCachedTagIconMap();
    const tagIcon = tagIconMap?.get(tagKey) ?? null;
    const tagLink = createEl("a", {
      href: `/tag/${tag}`,
      "data-tag-name": tag,
      class: "discourse-tag box",
    });
    if (tagIcon) {
      tagLink.appendChild(createTagIconSpan(tagIcon));
    }
    tagLink.append(tag);
    list.appendChild(tagLink);
  });
  return list;
}

function parsePosterExtras(extras?: string | null): string[] {
  if (!extras) {
    return [];
  }
  return extras.split(" ").filter((value) => value.length > 0);
}

function buildPosterTitle(user: User, poster: TopicPoster): string {
  const displayName = user.name ?? user.username;
  if (poster.description) {
    return `${displayName} - ${poster.description}`;
  }
  return displayName;
}

function createPosterLink(
  poster: TopicPoster,
  user: User | undefined
): HTMLAnchorElement | null {
  if (!user) {
    return null;
  }
  const extras = parsePosterExtras(poster.extras);
  const classes = extras.filter((value) => value === "latest" || value === "single");
  const anchorAttrs: Record<string, string> = {
    href: `/u/${user.username}`,
    "data-user-card": user.username,
    "aria-label": `${user.username} 的个人资料`,
    tabindex: "0",
  };
  if (classes.length > 0) {
    anchorAttrs.class = classes.join(" ");
  }
  const imgClasses = ["avatar", ...classes].join(" ");
  const img = createEl("img", {
    alt: "",
    width: "24",
    height: "24",
    loading: "lazy",
    src: buildAvatarUrl(user),
    class: imgClasses,
    title: buildPosterTitle(user, poster),
  });
  return createEl("a", anchorAttrs, [img]);
}

function createPostersCell(topic: Topic, users: Map<number, User>): HTMLTableCellElement {
  const postersTd = createEl("td", { class: "posters topic-list-data" });
  topic.posters.forEach((poster) => {
    const user = users.get(poster.user_id);
    const link = createPosterLink(poster, user);
    if (link) {
      postersTd.appendChild(link);
    }
  });
  return postersTd;
}

function getReplyCount(topic: Topic): number {
  const postCount = topic.posts_count;
  if (typeof postCount === "number" && Number.isFinite(postCount)) {
    return Math.max(0, postCount - 1);
  }
  return 0;
}

function getHeatLevelByValue(
  value: number,
  low: number,
  medium: number,
  high: number
): string | null {
  if (value >= high) {
    return "high";
  }
  if (value >= medium) {
    return "med";
  }
  if (value >= low) {
    return "low";
  }
  return null;
}

function getViewsHeatClass(views: number): string | null {
  const settings = getHeatSettings();
  if (!settings) {
    return null;
  }
  const level = getHeatLevelByValue(
    views,
    settings.topicViews.low,
    settings.topicViews.medium,
    settings.topicViews.high
  );
  return level ? `heatmap-${level}` : null;
}

function getLikesHeatClass(topic: Topic): string | null {
  const settings = getHeatSettings();
  if (!settings) {
    return null;
  }
  const postCount = topic.posts_count ?? 0;
  if (postCount < 10) {
    return null;
  }
  const likeCount = topic.like_count ?? 0;
  const ratio = likeCount / postCount;
  const likeSettings = settings.topicPostLike;
  if (ratio > likeSettings.high) {
    return "heatmap-high";
  }
  if (ratio > likeSettings.medium) {
    return "heatmap-med";
  }
  if (ratio > likeSettings.low) {
    return "heatmap-low";
  }
  return null;
}

function applyTagIconsToCustomList(tagIconMap: TagIconMap): void {
  const container = document.getElementById(CUSTOM_LIST_CONTAINER_ID);
  const scope = container ?? document;
  scope.querySelectorAll<HTMLAnchorElement>(".discourse-tag").forEach((link) => {
    if (link.querySelector(".tag-icon")) {
      return;
    }
    const tagName = link.getAttribute("data-tag-name") ?? link.textContent ?? "";
    const tagKey = normalizeTagKey(tagName);
    const tagIcon = tagIconMap.get(tagKey);
    if (!tagIcon) {
      return;
    }
    link.insertBefore(createTagIconSpan(tagIcon), link.firstChild);
  });
}

function updateTagIconsIfNeeded(): void {
  const cached = getCachedTagIconMap();
  if (cached) {
    applyTagIconsToCustomList(cached);
    return;
  }
  if (isTagIconFetchPending) {
    return;
  }
  isTagIconFetchPending = true;
  ensureTagIconMap()
    .then((map) => {
      if (map) {
        applyTagIconsToCustomList(map);
      }
    })
    .catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("Failed to load tag icons:", error);
      }
    })
    .finally(() => {
      isTagIconFetchPending = false;
    });
}

function createRepliesCell(topic: Topic): HTMLTableCellElement {
  const replies = getReplyCount(topic);
  const link = createEl("a", {
    href: `/t/${topic.slug}/${topic.id}/1`,
    class: "badge-posts",
    "aria-label": `${replies} 条回复，跳转到第一个帖子`,
  });
  link.appendChild(createEl("span", { class: "number" }, [String(replies)]));
  const classes = ["num", "posts-map", "posts", "topic-list-data"];
  const likesHeat = getLikesHeatClass(topic);
  if (likesHeat) {
    classes.push(likesHeat);
  }
  return createEl("td", { class: classes.join(" ") }, [link]);
}

function createViewsCell(topic: Topic): HTMLTableCellElement {
  const views = topic.views ?? 0;
  const viewsText = formatCompactNumber(views);
  const span = createEl("span", {
    class: "number",
    title: `此话题已被浏览 ${formatFullNumber(views)} 次`,
  }, [viewsText]);
  const classes = ["num", "views", "topic-list-data"];
  const viewsHeat = getViewsHeatClass(views);
  if (viewsHeat) {
    classes.push(viewsHeat);
  }
  return createEl("td", { class: classes.join(" ") }, [span]);
}

function createActivityCell(topic: Topic): HTMLTableCellElement {
  const activityTitle = buildActivityTitle(topic.created_at, topic.last_posted_at, topic.bumped_at);
  const activityAttrs: Record<string, string> = {
    class: "activity num topic-list-data age",
  };
  if (activityTitle) {
    activityAttrs.title = activityTitle;
  }
  const lastPostNumber = topic.highest_post_number ?? topic.posts_count ?? 1;
  const link = createEl("a", {
    href: `/t/${topic.slug}/${topic.id}/${lastPostNumber}`,
    class: "post-activity",
  });
  const relativeDate = createEl("span", {
    class: "relative-date",
    "data-time": String(new Date(topic.bumped_at).getTime()),
    "data-format": "tiny",
  }, [formatRelativeTimeTiny(topic.bumped_at)]);
  link.appendChild(relativeDate);
  return createEl("td", activityAttrs, [link]);
}

function createTopicRow(
  topic: Topic,
  users: Map<number, User>,
  categories: Map<number, CategoryInfo>
): HTMLTableRowElement {
  const category = categories.get(topic.category_id);
  const parentCategory = category?.parent_category_id
    ? categories.get(category.parent_category_id)
    : undefined;
  const tr = createEl("tr", {
    class: buildTopicRowClass(topic, category, parentCategory),
    "data-topic-id": String(topic.id),
  });

  const mainTd = createEl("td", {
    class: "main-link topic-list-data",
    colspan: "1",
  });
  const linkTopLine = createEl("span", {
    class: "link-top-line",
    role: "heading",
    "aria-level": "2",
  });
  linkTopLine.appendChild(createTopicStatuses(topic));
  linkTopLine.appendChild(createTopicTitleLink(topic));
  linkTopLine.appendChild(createTopicBadges(topic));
  mainTd.appendChild(linkTopLine);

  const linkBottomLine = createEl("div", { class: "link-bottom-line" });
  if (category) {
    linkBottomLine.appendChild(createCategoryBadge(category, categories));
  }
  const tagsList = createTagsList(topic.tags);
  if (tagsList) {
    linkBottomLine.appendChild(tagsList);
  }
  if (linkBottomLine.childNodes.length > 0) {
    mainTd.appendChild(linkBottomLine);
  }

  const excerpt = createTopicExcerpt(topic);
  if (excerpt) {
    mainTd.appendChild(excerpt);
  }
  tr.appendChild(mainTd);

  tr.appendChild(createPostersCell(topic, users));
  tr.appendChild(createRepliesCell(topic));
  tr.appendChild(createViewsCell(topic));
  tr.appendChild(createActivityCell(topic));

  return tr;
}

export function renderTopicList(data: MergedTopicData, append = false): void {
  const container = ensureCustomListContainer();
  const tbody = container?.querySelector<HTMLTableSectionElement>(`#${CUSTOM_LIST_BODY_ID}`);
  if (!tbody) {
    return;
  }

  if (!append) {
    tbody.innerHTML = "";
  }

  data.topics.forEach((topic) => {
    const row = createTopicRow(topic, data.users, data.categories);
    tbody.appendChild(row);
  });

  updateTagIconsIfNeeded();
}

function getLoadingAnchor(): HTMLElement | null {
  const body = document.body;
  if (body?.classList.contains(CUSTOM_VIEW_CLASS)) {
    const container = document.getElementById(CUSTOM_LIST_CONTAINER_ID);
    if (container) {
      const table = container.querySelector<HTMLTableElement>("table");
      if (table) {
        return table;
      }
    }
  }
  return document.querySelector(".topic-list");
}

export function showLoading(): void {
  const indicator = getLoadingIndicator();
  if (indicator) {
    clearReadyTimeout();
    setLoadingState("loading");
  }

  const container = getLoadingAnchor();
  if (!container || indicator) {
    const fallback = document.getElementById("custom-loading");
    if (fallback) {
      fallback.style.display = "none";
    }
    return;
  }

  let loading = document.getElementById("custom-loading");
  if (!loading) {
    loading = createEl(
      "div",
      {
        id: "custom-loading",
        style: "text-align: center; padding: 20px; color: #666;",
      },
      ["加载中..."]
    );
    container.parentElement?.insertBefore(loading, container.nextSibling);
  }
  loading.style.display = "block";
}

export function hideLoading(): void {
  const indicator = getLoadingIndicator();
  if (indicator) {
    clearReadyTimeout();
    setLoadingState("done");
    readyTimeoutId = window.setTimeout(() => {
      setLoadingState("ready");
      readyTimeoutId = null;
    }, LOADING_READY_DELAY_MS);
  }

  const loading = document.getElementById("custom-loading");
  if (loading) {
    loading.style.display = "none";
  }
}
