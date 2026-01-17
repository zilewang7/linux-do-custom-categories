import { CategoryGroup } from "../types";
import { addCategoryGroup, updateCategoryGroup } from "../config/storage";
import { createEl } from "../utils/dom";

const ADD_BTN_ID = "custom-category-add-btn";
const TITLE_TEXT_CLASS = "custom-category-title-text";
const CUSTOM_CHECKBOX_CLASS = "custom-category-checkbox";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ModalState {
  isAddMode: boolean;
  selectedCategoryIds: Set<number>;
  originalTitle: string;
  originalDesc: string;
  originalSaveText: string;
  editingGroupId: string | null;
  nameInput: HTMLInputElement | null;
  cleanup: (() => void) | null;
}

const state: ModalState = {
  isAddMode: false,
  selectedCategoryIds: new Set(),
  originalTitle: "",
  originalDesc: "",
  originalSaveText: "",
  editingGroupId: null,
  nameInput: null,
  cleanup: null,
};

let pendingEditGroup: CategoryGroup | null = null;

export function requestEditGroup(group: CategoryGroup): void {
  pendingEditGroup = group;
}

function resetState(): void {
  state.isAddMode = false;
  state.selectedCategoryIds.clear();
  state.editingGroupId = null;
  state.nameInput = null;
  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }
}

function closeModal(modal: HTMLElement): void {
  const root = modal.closest(".d-modal") ?? modal;
  const closeBtn = root.querySelector<HTMLButtonElement>(
    ".d-modal__close, .d-modal__dismiss, button[aria-label=\"关闭\"], button[aria-label=\"close\"], button[data-dismiss=\"modal\"]"
  );
  if (closeBtn) {
    closeBtn.click();
    return;
  }

  const backdrop = root.querySelector<HTMLElement>(".d-modal__backdrop, .d-modal__overlay, .modal-backdrop");
  if (backdrop) {
    backdrop.click();
    return;
  }

  const keydownEvent = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true });
  const keyupEvent = new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true });
  root.dispatchEvent(keydownEvent);
  document.dispatchEvent(keydownEvent);
  window.dispatchEvent(keydownEvent);
  root.dispatchEvent(keyupEvent);
  document.dispatchEvent(keyupEvent);
  window.dispatchEvent(keyupEvent);
}

function getTitleTextElement(titleEl: HTMLElement): HTMLElement {
  const existing = titleEl.querySelector<HTMLElement>(`.${TITLE_TEXT_CLASS}`);
  if (existing) {
    return existing;
  }

  const wrapper = createEl("span", { class: TITLE_TEXT_CLASS });
  while (titleEl.firstChild) {
    wrapper.appendChild(titleEl.firstChild);
  }
  titleEl.appendChild(wrapper);
  return wrapper;
}

interface EnterAddModeOptions {
  group?: CategoryGroup;
}

function enterAddMode(modal: HTMLElement, onSave: () => void, options?: EnterAddModeOptions): void {
  const editingGroup = options?.group ?? null;
  state.isAddMode = true;
  state.selectedCategoryIds.clear();
  if (editingGroup) {
    editingGroup.categoryIds.forEach((id) => state.selectedCategoryIds.add(id));
  }
  state.editingGroupId = editingGroup?.id ?? null;

  const titleEl = modal.querySelector<HTMLElement>(".d-modal__title-text");
  const titleTextEl = titleEl ? getTitleTextElement(titleEl) : null;
  const descEl = modal.querySelector<HTMLElement>(".sidebar__edit-navigation-menu__deselect-wrapper");
  const saveBtn = modal.querySelector<HTMLButtonElement>(".sidebar__edit-navigation-menu__save-button");
  const addBtn = modal.querySelector<HTMLElement>(`#${ADD_BTN_ID}`);
  const resetButtonSelector =
    ".sidebar__edit-navigation-menu__reset-defaults-button, .sidebar__edit-navigation-menu__deselect-button";
  const resetButtonText = "清除选中";

  if (titleTextEl) {
    state.originalTitle = titleTextEl.textContent ?? "";
    titleTextEl.textContent = editingGroup ? "编辑自定义类别" : "自定义类别添加";
  }

  if (descEl) {
    state.originalDesc = descEl.textContent ?? "";
    descEl.textContent = "组合多个类别以自定义";
  }

  if (saveBtn) {
    state.originalSaveText = saveBtn.textContent ?? "";
    saveBtn.textContent = editingGroup ? "保存自定义类别" : "添加自定义类别";
  }

  if (addBtn) {
    addBtn.style.display = "none";
  }

  const initialName = editingGroup?.name ?? "";

  const ensureNameInput = () => {
    const currentDescEl = modal.querySelector<HTMLElement>(".sidebar__edit-navigation-menu__deselect-wrapper");
    if (!currentDescEl) {
      return;
    }

    const existingNameInput = modal.querySelector<HTMLInputElement>("#custom-category-name-wrapper input");
    if (existingNameInput) {
      state.nameInput = existingNameInput;
      if (existingNameInput.value !== initialName) {
        existingNameInput.value = initialName;
      }
      return;
    }

    const inputWrapper = createEl("div", {
      id: "custom-category-name-wrapper",
      style: "margin-top: 12px; display: flex; align-items: center; gap: 8px;",
    }, [
      createEl("label", { style: "font-weight: 500;" }, ["自定义类别名:"]),
    ]);
    const nameInput = createEl("input", {
      type: "text",
      placeholder: "输入名称",
      style: "flex: 1; padding: 6px 10px; border: 1px solid var(--primary-low); border-radius: 4px;",
    });
    nameInput.value = initialName;
    inputWrapper.appendChild(nameInput);
    state.nameInput = nameInput;
    currentDescEl.after(inputWrapper);
  };

  const removeFilterDropdown = () => {
    modal.querySelectorAll<HTMLElement>(".sidebar__edit-navigation-menu__filter-dropdown-wrapper").forEach((node) => {
      node.remove();
    });
  };

  const getResetButton = () => modal.querySelector<HTMLButtonElement>(resetButtonSelector);
  const updateResetText = () => {
    const resetBtn = getResetButton();
    if (!resetBtn) {
      return;
    }
    const label = resetBtn.querySelector<HTMLElement>(".d-button-label");
    if (label) {
      const currentText = label.textContent?.trim() ?? "";
      if (currentText !== resetButtonText) {
        label.textContent = resetButtonText;
      }
      return;
    }
    if (resetBtn.textContent?.includes(resetButtonText)) {
      return;
    }
    const fallbackLabel = createEl("span", { class: "d-button-label" }, [resetButtonText]);
    resetBtn.appendChild(fallbackLabel);
  };

  const getForm = () => modal.querySelector<HTMLFormElement>(".sidebar-categories-form");

  const parseCategoryId = (rawId: string | undefined): number | null => {
    if (!rawId) {
      return null;
    }
    const id = Number(rawId);
    return Number.isNaN(id) ? null : id;
  };

  const getCategoryIdFromElement = (element: HTMLElement | null): number | null => {
    const row = element?.closest<HTMLElement>("[data-category-id]");
    if (!row) {
      return null;
    }
    return parseCategoryId(row.dataset.categoryId);
  };

  const syncCustomCheckboxes = () => {
    const form = getForm();
    if (!form) {
      return;
    }
    form.querySelectorAll<HTMLInputElement>(`.${CUSTOM_CHECKBOX_CLASS}`).forEach((input) => {
      const id = getCategoryIdFromElement(input);
      if (id === null) {
        return;
      }
      const shouldCheck = state.selectedCategoryIds.has(id);
      if (input.checked !== shouldCheck) {
        input.checked = shouldCheck;
      }
    });
  };

  const ensureCustomCheckboxes = () => {
    const form = getForm();
    if (!form) {
      return;
    }
    form.querySelectorAll<HTMLElement>("[data-category-id]").forEach((row) => {
      const label = row.querySelector<HTMLElement>("label.sidebar-categories-form__category-label");
      const originalInput = row.querySelector<HTMLInputElement>(".sidebar-categories-form__input");
      if (!label || !originalInput) {
        return;
      }

      const categoryId = getCategoryIdFromElement(row);
      if (categoryId === null) {
        return;
      }

      const customInputId = `custom-category-input--${categoryId}`;
      let customInput = label.querySelector<HTMLInputElement>(`#${customInputId}`);

      originalInput.checked = false;
      originalInput.style.display = "none";
      originalInput.setAttribute("aria-hidden", "true");
      originalInput.tabIndex = -1;

      if (!label.dataset.customOriginalFor) {
        label.dataset.customOriginalFor = label.getAttribute("for") ?? "";
      }
      label.setAttribute("for", customInputId);

      if (!customInput) {
        customInput = createEl("input", {
          id: customInputId,
          type: "checkbox",
          class: CUSTOM_CHECKBOX_CLASS,
          style: "margin-left: 8px; display: inline-block; opacity: 1; position: static; pointer-events: auto; appearance: auto; -webkit-appearance: auto;",
          "data-category-id": String(categoryId),
        });
        originalInput.after(customInput);
      }

      if (!customInput.dataset.customCheckboxBound) {
        customInput.dataset.customCheckboxBound = "true";
        customInput.addEventListener("change", (e) => {
          if (!state.isAddMode) return;
          e.stopPropagation();
          const id = getCategoryIdFromElement(customInput);
          if (id === null) {
            return;
          }
          if (customInput.checked) {
            state.selectedCategoryIds.add(id);
          } else {
            state.selectedCategoryIds.delete(id);
          }
        });
      }
    });

    syncCustomCheckboxes();
  };

  const clearSelections = () => {
    state.selectedCategoryIds.clear();
    syncCustomCheckboxes();
  };

  const applyAddModeDecorations = () => {
    if (!state.isAddMode) {
      return;
    }
    removeFilterDropdown();
    ensureNameInput();
    ensureCustomCheckboxes();
    updateResetText();
  };

  // observe modal changes so add mode works even before list loads
  const formObserver = new MutationObserver(() => {
    applyAddModeDecorations();
  });
  formObserver.observe(modal, { childList: true, subtree: true });

  applyAddModeDecorations();
  if (editingGroup) {
    syncCustomCheckboxes();
  } else {
    clearSelections();
  }

  const formCleanup = state.cleanup;
  state.cleanup = () => {
    formCleanup?.();
    formObserver.disconnect();
  };

  // intercept reset button to clear selections (delegate for rerendered buttons)
  const handleReset = (e: Event) => {
    if (!state.isAddMode) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const resetBtn = target.closest(resetButtonSelector);
    if (!resetBtn) return;
    e.preventDefault();
    e.stopPropagation();

    // clear selected category ids
    clearSelections();
  };
  modal.addEventListener("click", handleReset, true);
  const resetCleanup = () => {
    modal.removeEventListener("click", handleReset, true);
  };
  const originalCleanup = state.cleanup;
  state.cleanup = () => {
    originalCleanup?.();
    resetCleanup();
  };

  // intercept save button
  if (saveBtn) {
    const handleSave = (e: Event) => {
      if (!state.isAddMode) return;
      e.preventDefault();
      e.stopPropagation();

      const name = state.nameInput?.value.trim();
      if (!name) {
        alert("请输入自定义类别名");
        return;
      }
      if (state.selectedCategoryIds.size === 0) {
        alert("请至少选择一个类别");
        return;
      }

      const categoryIds = Array.from(state.selectedCategoryIds);
      if (state.editingGroupId) {
        const updatedGroup: CategoryGroup = {
          id: state.editingGroupId,
          name,
          categoryIds,
        };
        updateCategoryGroup(updatedGroup);
      } else {
        const newGroup: CategoryGroup = {
          id: generateId(),
          name,
          categoryIds,
        };
        addCategoryGroup(newGroup);
      }

      // close modal
      closeModal(modal);

      onSave();
    };
    saveBtn.addEventListener("click", handleSave, true);
    const originalCleanup = state.cleanup;
    state.cleanup = () => {
      originalCleanup?.();
      saveBtn.removeEventListener("click", handleSave, true);
    };
  }
}

function injectAddButton(modal: HTMLElement, onSave: () => void): void {
  if (modal.querySelector(`#${ADD_BTN_ID}`)) return;

  const titleEl = modal.querySelector<HTMLElement>(".d-modal__title-text");
  if (!titleEl) return;
  getTitleTextElement(titleEl);

  const btn = createEl("button", {
    id: ADD_BTN_ID,
    class: "btn btn-small btn-primary",
    style: "margin-left: 12px; font-size: 12px; white-space: nowrap; vertical-align: middle;",
    type: "button",
  }, ["添加自定义类别"]);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterAddMode(modal, onSave);
  });

  titleEl.appendChild(btn);
}

export function initModalObserver(onSave: () => void): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const modal = node.matches(".d-modal__container")
          ? node
          : node.querySelector?.(".d-modal__container");
        if (modal instanceof HTMLElement) {
          const title = modal.querySelector(".d-modal__title-text");
          if (title?.textContent?.includes("编辑类别导航")) {
            injectAddButton(modal, onSave);
            if (pendingEditGroup) {
              const group = pendingEditGroup;
              pendingEditGroup = null;
              enterAddMode(modal, onSave, { group });
            }
          }
        }
      }
      for (const node of mutation.removedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(".d-modal__container") || node.querySelector?.(".d-modal__container")) {
          resetState();
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
