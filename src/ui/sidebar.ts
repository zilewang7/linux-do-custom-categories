import { CategoryGroup } from "../types";
import { deleteCategoryGroup, getCategoryGroups } from "../config/storage";
import { createEl, waitForElement } from "../utils/dom";
import { requestEditGroup } from "./configPanel";
import { CUSTOM_URL_PREFIX } from "../main";

const CATEGORY_LIST_SELECTOR = "#sidebar-section-content-categories";
const CATEGORY_SECTION_SELECTOR = '[data-section-name="categories"]';
const CUSTOM_ITEM_CLASS = "custom-category-group-item";
const CUSTOM_ACTIONS_CLASS = "custom-category-group-actions";
const CUSTOM_ACTION_CLASS = "custom-category-action";
const CUSTOM_STYLE_ID = "custom-category-group-style";
const ACTIVE_CLASS = "active";
const LISTENER_ATTACHED_ATTR = "data-custom-group-listener";
let activeGroupId: string | null = null;

function buildCustomGroupHref(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "#";
  }
  return `${CUSTOM_URL_PREFIX}${encodeURIComponent(trimmed)}`;
}

function clearActiveLinks(list: HTMLUListElement): void {
  list
    .querySelectorAll<HTMLAnchorElement>(".sidebar-section-link.active")
    .forEach((link) => {
      link.classList.remove(ACTIVE_CLASS);
      link.removeAttribute("aria-current");
    });
}

function clearActiveCustomLinks(list: HTMLUListElement): void {
  list
    .querySelectorAll<HTMLAnchorElement>(
      `a.sidebar-section-link[data-custom-group-id].${ACTIVE_CLASS}`,
    )
    .forEach((link) => {
      link.classList.remove(ACTIVE_CLASS);
      link.removeAttribute("aria-current");
    });
}

function ensureListListener(list: HTMLUListElement): void {
  if (list.getAttribute(LISTENER_ATTACHED_ATTR) === "true") {
    return;
  }
  list.setAttribute(LISTENER_ATTACHED_ATTR, "true");
  list.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
    if (!target) {
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a.sidebar-section-link");
    if (!link || link.getAttribute("data-custom-group-id")) {
      return;
    }
    activeGroupId = null;
    clearActiveCustomLinks(list);
  });
}

function applyActiveGroup(list: HTMLUListElement): void {
  if (!activeGroupId) {
    return;
  }
  const link = list.querySelector<HTMLAnchorElement>(
    `a.sidebar-section-link[data-custom-group-id="${activeGroupId}"]`,
  );
  if (!link) {
    activeGroupId = null;
    return;
  }
  clearActiveLinks(list);
  link.classList.add(ACTIVE_CLASS);
  link.setAttribute("aria-current", "page");
}

export function setActiveCustomGroup(groupId: string): void {
  activeGroupId = groupId;
  const list = document.querySelector<HTMLUListElement>(CATEGORY_LIST_SELECTOR);
  if (!list) {
    return;
  }
  const link = list.querySelector<HTMLAnchorElement>(
    `a.sidebar-section-link[data-custom-group-id="${groupId}"]`,
  );
  if (!link) {
    return;
  }
  clearActiveLinks(list);
  link.classList.add(ACTIVE_CLASS);
  link.setAttribute("aria-current", "page");
}

export function clearActiveCustomGroup(): void {
  activeGroupId = null;
  const list = document.querySelector<HTMLUListElement>(CATEGORY_LIST_SELECTOR);
  if (!list) {
    return;
  }
  clearActiveCustomLinks(list);
}

function ensureCustomStyles(): void {
  if (document.getElementById(CUSTOM_STYLE_ID)) {
    return;
  }

  const styles = `
    .${CUSTOM_ITEM_CLASS} .${CUSTOM_ACTIONS_CLASS} {
      opacity: 0;
      pointer-events: none;
      margin-left: auto;
      display: inline-flex;
      gap: 6px;
      transition: opacity 0.15s ease;
    }

    .${CUSTOM_ITEM_CLASS}:hover .${CUSTOM_ACTIONS_CLASS},
    .${CUSTOM_ITEM_CLASS}:focus-within .${CUSTOM_ACTIONS_CLASS} {
      opacity: 1;
      pointer-events: auto;
    }

    .${CUSTOM_ITEM_CLASS} .${CUSTOM_ACTION_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      cursor: pointer;
    }

    .${CUSTOM_ITEM_CLASS} .${CUSTOM_ACTION_CLASS}:hover {
      background: var(--primary-low, rgba(0, 0, 0, 0.08));
    }
  `;

  const styleEl = createEl("style", { id: CUSTOM_STYLE_ID }, [styles]);
  document.head.appendChild(styleEl);
}

function createIconSvg(icon: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute(
    "class",
    `fa d-icon d-icon-${icon} svg-icon fa-width-auto svg-string`,
  );
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${icon}`);
  svg.appendChild(use);
  return svg;
}

function createAction(
  label: string,
  icon: string,
  onActivate: () => void,
): HTMLSpanElement {
  const action = createEl("span", {
    class: CUSTOM_ACTION_CLASS,
    role: "button",
    tabindex: "0",
    title: label,
    "aria-label": label,
  });
  action.appendChild(createIconSvg(icon));

  const handleActivate = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  };

  action.addEventListener("click", handleActivate);
  action.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      handleActivate(event);
    }
  });

  return action;
}

function openCategoryEditModal(): void {
  const editButton = document.querySelector<HTMLButtonElement>(
    `${CATEGORY_SECTION_SELECTOR} .sidebar-section-header-button`,
  );
  editButton?.click();
}

function createCustomItem(
  group: CategoryGroup,
  onGroupClick: (group: CategoryGroup) => void,
  onRefresh: () => void,
): HTMLLIElement {
  const actions = createEl("span", {
    class: `sidebar-section-link-suffix ${CUSTOM_ACTIONS_CLASS}`,
  });

  const handleEdit = () => {
    requestEditGroup(group);
    openCategoryEditModal();
  };

  const handleDelete = () => {
    const confirmed = confirm(`确认删除自定义类别“${group.name}”？`);
    if (!confirmed) {
      return;
    }
    deleteCategoryGroup(group.id);
    onRefresh();
  };

  actions.append(
    createAction("编辑", "pencil", handleEdit),
    createAction("删除", "trash-can", handleDelete),
  );

  const link = createEl(
    "a",
    {
      class: "sidebar-section-link sidebar-row",
      href: buildCustomGroupHref(group.name),
      "data-custom-group-id": group.id,
    },
    [
      createEl("span", { class: "sidebar-section-link-prefix icon" }, [
        createEl("span", {
          style: "width: 1em; height: 1em; display: inline-block;",
        }),
      ]),
      createEl("span", { class: "sidebar-section-link-content-text" }, [
        group.name,
      ]),
      actions,
    ],
  );

  link.addEventListener("click", (e) => {
    e.preventDefault();
    onGroupClick(group);
  });

  const li = createEl("li", {
    class: `sidebar-section-link-wrapper ${CUSTOM_ITEM_CLASS}`,
    "data-custom-group-id": group.id,
  });
  li.appendChild(link);

  return li;
}

function renderCustomGroups(
  list: HTMLUListElement,
  onGroupClick: (group: CategoryGroup) => void,
): void {
  ensureCustomStyles();
  ensureListListener(list);
  list
    .querySelectorAll(`.${CUSTOM_ITEM_CLASS}`)
    .forEach((item) => item.remove());

  const groups = getCategoryGroups();
  if (groups.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  const refresh = () => refreshSidebar(onGroupClick);

  groups.forEach((group) => {
    fragment.appendChild(createCustomItem(group, onGroupClick, refresh));
  });

  list.insertBefore(fragment, list.firstChild);
  applyActiveGroup(list);
}

export async function injectSidebar(
  onGroupClick: (group: CategoryGroup) => void,
): Promise<void> {
  const list = await waitForElement<HTMLUListElement>(CATEGORY_LIST_SELECTOR);
  renderCustomGroups(list, onGroupClick);
}

export function refreshSidebar(
  onGroupClick: (group: CategoryGroup) => void,
): void {
  const list = document.querySelector<HTMLUListElement>(CATEGORY_LIST_SELECTOR);
  if (!list) {
    return;
  }
  renderCustomGroups(list, onGroupClick);
}
