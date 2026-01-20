import { createEl } from "../utils/dom";

const PROGRESS_STYLE_ID = "custom-category-fetch-progress-style";
const PROGRESS_ID = "custom-category-fetch-progress";
const VISIBLE_CLASS = "custom-category-fetch-progress--visible";
const ERROR_CLASS = "custom-category-fetch-progress--error";
const SUCCESS_CLASS = "custom-category-fetch-progress--success";
const HIDE_DELAY_MS = 2400;
const HIDE_DELAY_MS_FAILURE = 5000;

type ProgressState = {
  total: number;
  success: number;
  failed: number;
  done: boolean;
};

export type FetchProgressTracker = {
  markSuccess: () => void;
  markFailure: () => void;
  finish: (options?: { aborted?: boolean }) => void;
};

const NOOP_TRACKER: FetchProgressTracker = {
  markSuccess: () => undefined,
  markFailure: () => undefined,
  finish: () => undefined,
};

let hideTimeoutId: number | null = null;

function clearHideTimeout(): void {
  if (hideTimeoutId === null) {
    return;
  }
  window.clearTimeout(hideTimeoutId);
  hideTimeoutId = null;
}

function ensureProgressStyles(): void {
  if (document.getElementById(PROGRESS_STYLE_ID)) {
    return;
  }
  const styles = `
    #${PROGRESS_ID} {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 1100;
      max-width: calc(100vw - 24px);
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(20, 20, 20, 0.45);
      color: #f5f5f5;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
      pointer-events: none;
    }

    #${PROGRESS_ID}.${VISIBLE_CLASS} {
      opacity: 1;
      transform: translateY(0);
    }

    #${PROGRESS_ID}.${ERROR_CLASS} {
      background: rgba(230, 80, 80, 0.22);
      color: #4b1717;
      box-shadow: 0 6px 16px rgba(230, 80, 80, 0.12);
    }

    #${PROGRESS_ID}.${SUCCESS_CLASS} {
      background: rgba(70, 170, 110, 0.22);
      color: #10341f;
      box-shadow: 0 6px 16px rgba(70, 170, 110, 0.12);
    }
  `;
  const styleEl = createEl("style", { id: PROGRESS_STYLE_ID }, [styles]);
  document.head.appendChild(styleEl);
}

function ensureProgressElement(): HTMLDivElement {
  ensureProgressStyles();
  const existing = document.getElementById(PROGRESS_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }
  const el = createEl("div", {
    id: PROGRESS_ID,
    role: "status",
    "aria-live": "polite",
  });
  document.body.appendChild(el);
  return el;
}

function updateProgressText(
  element: HTMLDivElement,
  state: ProgressState,
): void {
  element.textContent = `拉取中 ${state.success}/${state.total}`;
}

function updateFinalText(element: HTMLDivElement, state: ProgressState): void {
  if (state.failed > 0) {
    element.textContent = `拉取到 ${state.success}/${state.total} 种类别，${state.failed} 条失败`;
    return;
  }
  element.textContent = `拉取完成，共 ${state.success} 种类别`;
}

function showProgress(element: HTMLDivElement): void {
  element.classList.add(VISIBLE_CLASS);
}

function hideProgress(element: HTMLDivElement): void {
  element.classList.remove(VISIBLE_CLASS);
}

function clampToTotal(value: number, total: number): number {
  if (value < 0) {
    return 0;
  }
  return Math.min(value, total);
}

export function startFetchProgress(total: number): FetchProgressTracker {
  if (total <= 0) {
    return NOOP_TRACKER;
  }

  const state: ProgressState = {
    total,
    success: 0,
    failed: 0,
    done: false,
  };

  const element = ensureProgressElement();
  clearHideTimeout();
  element.classList.remove(ERROR_CLASS);
  element.classList.remove(SUCCESS_CLASS);
  updateProgressText(element, state);
  showProgress(element);

  const advance = (failed: boolean): void => {
    if (state.done) {
      return;
    }
    if (failed) {
      state.failed = clampToTotal(state.failed + 1, state.total);
    } else {
      state.success = clampToTotal(state.success + 1, state.total);
    }
    updateProgressText(element, state);
    showProgress(element);
  };

  return {
    markSuccess: () => advance(false),
    markFailure: () => advance(true),
    finish: (options) => {
      if (state.done) {
        return;
      }
      state.done = true;
      clearHideTimeout();
      if (options?.aborted) {
        hideProgress(element);
        element.classList.remove(ERROR_CLASS);
        element.classList.remove(SUCCESS_CLASS);
        return;
      }
      const hasFailed = state.failed > 0;
      if (hasFailed) {
        element.classList.add(ERROR_CLASS);
        element.classList.remove(SUCCESS_CLASS);
      } else {
        element.classList.remove(ERROR_CLASS);
        element.classList.add(SUCCESS_CLASS);
      }
      updateFinalText(element, state);
      showProgress(element);
      hideTimeoutId = window.setTimeout(
        () => {
          hideProgress(element);
        },
        hasFailed ? HIDE_DELAY_MS_FAILURE : HIDE_DELAY_MS,
      );
    },
  };
}
