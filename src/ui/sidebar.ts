import { CategoryGroup } from "../types";
import {
  deleteCategoryGroup,
  getCategoryGroups,
  saveCategoryGroups,
} from "../config/storage";
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
const DRAG_LISTENER_ATTR = "data-custom-group-dnd";
const CUSTOM_DRAG_HANDLE_CLASS = "custom-category-drag-handle";
const CUSTOM_DRAGGING_CLASS = "custom-category-dragging";
const CUSTOM_DROP_TARGET_CLASS = "custom-category-drop-target";
const DROP_POSITION_ATTR = "data-drop-position";
let activeGroupId: string | null = null;
let draggingGroupId: string | null = null;
let dropTargetId: string | null = null;
let isDragging = false;
let dropPosition: "before" | "after" = "before";
let activePointerId: number | null = null;
let activeTouchId: number | null = null;

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

    .${CUSTOM_ITEM_CLASS} .${CUSTOM_DRAG_HANDLE_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1em;
      height: 1em;
      opacity: 0;
      pointer-events: none;
      color: var(--primary-medium, #888);
      cursor: grab;
      touch-action: none;
      transition: opacity 0.15s ease;
    }

    .mobile-view .${CUSTOM_ITEM_CLASS} .${CUSTOM_DRAG_HANDLE_CLASS} {
      opacity: 1;
      pointer-events: auto;
    }

    .${CUSTOM_ITEM_CLASS}:hover .${CUSTOM_DRAG_HANDLE_CLASS} {
      opacity: 1;
      pointer-events: auto;
    }

    .${CUSTOM_ITEM_CLASS}.${CUSTOM_DRAGGING_CLASS} {
      opacity: 0.6;
    }

    .${CUSTOM_ITEM_CLASS}.${CUSTOM_DROP_TARGET_CLASS} {
      background: var(--primary-low, rgba(0, 0, 0, 0.06));
      border-radius: 6px;
    }

    .${CUSTOM_ITEM_CLASS}.${CUSTOM_DROP_TARGET_CLASS}[${DROP_POSITION_ATTR}="before"] {
      box-shadow: inset 0 2px 0 var(--primary-medium, rgba(0, 0, 0, 0.2));
    }

    .${CUSTOM_ITEM_CLASS}.${CUSTOM_DROP_TARGET_CLASS}[${DROP_POSITION_ATTR}="after"] {
      box-shadow: inset 0 -2px 0 var(--primary-medium, rgba(0, 0, 0, 0.2));
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

function createDragHandle(): HTMLSpanElement {
  const handle = createEl("span", {
    class: CUSTOM_DRAG_HANDLE_CLASS,
    draggable: "true",
    role: "button",
    tabindex: "0",
    title: "拖拽排序",
    "aria-label": "拖拽排序",
  });
  handle.appendChild(createIconSvg("grip-lines"));
  handle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  return handle;
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
      draggable: "false",
      "data-custom-group-id": group.id,
    },
    [
      createEl("span", { class: "sidebar-section-link-prefix icon" }, [
        createDragHandle(),
      ]),
      createEl("span", { class: "sidebar-section-link-content-text" }, [
        group.name,
      ]),
      actions,
    ],
  );

  link.addEventListener("click", (e) => {
    e.preventDefault();
    if (isDragging) {
      return;
    }
    onGroupClick(group);
  });

  const li = createEl("li", {
    class: `sidebar-section-link-wrapper ${CUSTOM_ITEM_CLASS}`,
    "data-custom-group-id": group.id,
  });
  li.appendChild(link);

  return li;
}

function getCustomItemFromTarget(target: EventTarget | null): HTMLLIElement | null {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  if (!element) {
    return null;
  }
  const item = element.closest<HTMLLIElement>(
    `.${CUSTOM_ITEM_CLASS}[data-custom-group-id]`,
  );
  return item ?? null;
}

function clearDropTarget(list: HTMLUListElement): void {
  if (!dropTargetId) {
    return;
  }
  const current = list.querySelector<HTMLLIElement>(
    `.${CUSTOM_ITEM_CLASS}[data-custom-group-id="${dropTargetId}"]`,
  );
  current?.classList.remove(CUSTOM_DROP_TARGET_CLASS);
  if (current) {
    delete current.dataset.dropPosition;
  }
  dropTargetId = null;
  dropPosition = "before";
}

function setDropTarget(
  list: HTMLUListElement,
  groupId: string,
  position: "before" | "after",
): void {
  if (dropTargetId === groupId && dropPosition === position) {
    return;
  }
  clearDropTarget(list);
  const next = list.querySelector<HTMLLIElement>(
    `.${CUSTOM_ITEM_CLASS}[data-custom-group-id="${groupId}"]`,
  );
  if (next) {
    next.classList.add(CUSTOM_DROP_TARGET_CLASS);
    next.dataset.dropPosition = position;
    dropTargetId = groupId;
    dropPosition = position;
  }
}

function reorderGroups(
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): boolean {
  if (sourceId === targetId) {
    return false;
  }
  const groups = getCategoryGroups();
  const fromIndex = groups.findIndex((group) => group.id === sourceId);
  const toIndex = groups.findIndex((group) => group.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return false;
  }
  const nextGroups = [...groups];
  const [moved] = nextGroups.splice(fromIndex, 1);
  let insertIndex = position === "after" ? toIndex + 1 : toIndex;
  if (fromIndex < insertIndex) {
    insertIndex -= 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, nextGroups.length));
  nextGroups.splice(insertIndex, 0, moved);
  saveCategoryGroups(nextGroups);
  return true;
}

function resolveDropPosition(item: HTMLLIElement, clientY: number): "before" | "after" {
  const rect = item.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  return clientY > midpoint ? "after" : "before";
}

function startDragging(item: HTMLLIElement, groupId: string): void {
  draggingGroupId = groupId;
  isDragging = true;
  item.classList.add(CUSTOM_DRAGGING_CLASS);
}

function finishDragging(list: HTMLUListElement): void {
  if (draggingGroupId) {
    const item = list.querySelector<HTMLLIElement>(
      `.${CUSTOM_ITEM_CLASS}[data-custom-group-id="${draggingGroupId}"]`,
    );
    item?.classList.remove(CUSTOM_DRAGGING_CLASS);
  }
  draggingGroupId = null;
  isDragging = false;
  clearDropTarget(list);
}

function applyDropIfNeeded(onRefresh: () => void): void {
  if (!draggingGroupId || !dropTargetId) {
    return;
  }
  const didMove = reorderGroups(draggingGroupId, dropTargetId, dropPosition);
  if (didMove) {
    onRefresh();
  }
}

function updateDropTargetFromPoint(
  list: HTMLUListElement,
  clientX: number,
  clientY: number,
): void {
  if (!draggingGroupId) {
    return;
  }
  const element = document.elementFromPoint(clientX, clientY);
  const item = getCustomItemFromTarget(element);
  if (!item) {
    clearDropTarget(list);
    return;
  }
  const groupId = item.getAttribute("data-custom-group-id");
  if (!groupId || groupId === draggingGroupId) {
    clearDropTarget(list);
    return;
  }
  const position = resolveDropPosition(item, clientY);
  setDropTarget(list, groupId, position);
}

function findTouchById(touches: TouchList, id: number): Touch | null {
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches.item(i);
    if (touch && touch.identifier === id) {
      return touch;
    }
  }
  return null;
}

function ensureDragAndDrop(list: HTMLUListElement, onRefresh: () => void): void {
  if (list.getAttribute(DRAG_LISTENER_ATTR) === "true") {
    return;
  }
  list.setAttribute(DRAG_LISTENER_ATTR, "true");

  list.addEventListener("dragstart", (event) => {
    const target = event.target;
    const handle =
      target instanceof Element
        ? target.closest(`.${CUSTOM_DRAG_HANDLE_CLASS}`)
        : null;
    if (!handle) {
      return;
    }
    const item = handle.closest<HTMLLIElement>(
      `.${CUSTOM_ITEM_CLASS}[data-custom-group-id]`,
    );
    if (!item) {
      return;
    }
    const groupId = item.getAttribute("data-custom-group-id");
    if (!groupId) {
      return;
    }
    startDragging(item, groupId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", groupId);
    }
  });

  list.addEventListener("dragend", () => {
    finishDragging(list);
  });

  list.addEventListener("dragover", (event) => {
    if (!draggingGroupId) {
      return;
    }
    const item = getCustomItemFromTarget(event.target);
    if (!item) {
      clearDropTarget(list);
      return;
    }
    const groupId = item.getAttribute("data-custom-group-id");
    if (!groupId || groupId === draggingGroupId) {
      clearDropTarget(list);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const position = resolveDropPosition(item, event.clientY);
    setDropTarget(list, groupId, position);
  });

  list.addEventListener("drop", (event) => {
    if (!draggingGroupId) {
      return;
    }
    const item = getCustomItemFromTarget(event.target);
    if (!item) {
      return;
    }
    const groupId = item.getAttribute("data-custom-group-id");
    if (!groupId || groupId === draggingGroupId) {
      return;
    }
    event.preventDefault();
    applyDropIfNeeded(onRefresh);
    finishDragging(list);
  });

  const supportsPointer = "PointerEvent" in window;
  if (supportsPointer) {
    list.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") {
        return;
      }
      const target = event.target;
      const handle =
        target instanceof Element
          ? target.closest(`.${CUSTOM_DRAG_HANDLE_CLASS}`)
          : null;
      if (!handle) {
        return;
      }
      const item = handle.closest<HTMLLIElement>(
        `.${CUSTOM_ITEM_CLASS}[data-custom-group-id]`,
      );
      if (!item) {
        return;
      }
      const groupId = item.getAttribute("data-custom-group-id");
      if (!groupId) {
        return;
      }
      event.preventDefault();
      activePointerId = event.pointerId;
      startDragging(item, groupId);
      if (handle instanceof HTMLElement) {
        handle.setPointerCapture(event.pointerId);
      }
      updateDropTargetFromPoint(list, event.clientX, event.clientY);
    });

    list.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") {
        return;
      }
      if (!draggingGroupId || activePointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      updateDropTargetFromPoint(list, event.clientX, event.clientY);
    });

    const handlePointerEnd = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") {
        return;
      }
      if (!draggingGroupId || activePointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      applyDropIfNeeded(onRefresh);
      activePointerId = null;
      finishDragging(list);
    };

    list.addEventListener("pointerup", handlePointerEnd);
    list.addEventListener("pointercancel", handlePointerEnd);
    return;
  }

  list.addEventListener(
    "touchstart",
    (event) => {
      const target = event.target;
      const handle =
        target instanceof Element
          ? target.closest(`.${CUSTOM_DRAG_HANDLE_CLASS}`)
          : null;
      if (!handle) {
        return;
      }
      const item = handle.closest<HTMLLIElement>(
        `.${CUSTOM_ITEM_CLASS}[data-custom-group-id]`,
      );
      if (!item) {
        return;
      }
      const groupId = item.getAttribute("data-custom-group-id");
      if (!groupId) {
        return;
      }
      const touch = event.touches.item(0);
      if (!touch) {
        return;
      }
      activeTouchId = touch.identifier;
      startDragging(item, groupId);
      updateDropTargetFromPoint(list, touch.clientX, touch.clientY);
      event.preventDefault();
    },
    { passive: false },
  );

  list.addEventListener(
    "touchmove",
    (event) => {
      if (!draggingGroupId || activeTouchId === null) {
        return;
      }
      const touch = findTouchById(event.touches, activeTouchId);
      if (!touch) {
        return;
      }
      updateDropTargetFromPoint(list, touch.clientX, touch.clientY);
      event.preventDefault();
    },
    { passive: false },
  );

  const handleTouchEnd = (event: TouchEvent): void => {
    if (!draggingGroupId || activeTouchId === null) {
      return;
    }
    const endedTouch = findTouchById(event.changedTouches, activeTouchId);
    if (!endedTouch) {
      return;
    }
    applyDropIfNeeded(onRefresh);
    activeTouchId = null;
    finishDragging(list);
  };

  list.addEventListener("touchend", handleTouchEnd);
  list.addEventListener("touchcancel", handleTouchEnd);
}

function renderCustomGroups(
  list: HTMLUListElement,
  onGroupClick: (group: CategoryGroup) => void,
): void {
  ensureCustomStyles();
  ensureListListener(list);
  ensureDragAndDrop(list, () => refreshSidebar(onGroupClick));
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
