import { GM_registerMenuCommand, GM_unregisterMenuCommand } from "$";
import {
  DEFAULT_REQUEST_CONTROL_SETTINGS,
  getRequestControlSettings,
  resetRequestControlSettings,
  saveRequestControlSettings,
} from "../config/storage";

const MENU_IDS = {
  concurrency: "custom-category-request-concurrency",
  delay: "custom-category-request-delay",
  reset: "custom-category-request-reset",
};

function unregisterMenuCommand(id: string): void {
  try {
    GM_unregisterMenuCommand(id);
  } catch (error) {
    // ignore unregister errors for compatibility
  }
}

function promptForNumber(label: string, currentValue: number, minValue: number): number | null {
  const input = window.prompt(`${label} (>= ${minValue})`, String(currentValue));
  if (input === null) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    window.alert("请输入有效数字");
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    window.alert("请输入有效数字");
    return null;
  }
  return Math.max(minValue, Math.round(parsed));
}

function refreshMenuCommands(): void {
  Object.values(MENU_IDS).forEach((id) => unregisterMenuCommand(id));

  const settings = getRequestControlSettings();
  GM_registerMenuCommand(
    `设置并发请求数量 (当前: ${settings.concurrency})`,
    () => {
      const currentSettings = getRequestControlSettings();
      const nextValue = promptForNumber("请输入并发请求数量", currentSettings.concurrency, 1);
      if (nextValue === null || nextValue === currentSettings.concurrency) {
        return;
      }
      saveRequestControlSettings({
        ...currentSettings,
        concurrency: nextValue,
      });
      refreshMenuCommands();
    },
    {
      id: MENU_IDS.concurrency,
      title: "控制同时发起的请求数量",
    }
  );

  GM_registerMenuCommand(
    `设置请求间隔 (当前: ${settings.requestDelayMs} ms)`,
    () => {
      const currentSettings = getRequestControlSettings();
      const nextValue = promptForNumber(
        "请输入请求间隔 (毫秒)",
        currentSettings.requestDelayMs,
        0
      );
      if (nextValue === null || nextValue === currentSettings.requestDelayMs) {
        return;
      }
      saveRequestControlSettings({
        ...currentSettings,
        requestDelayMs: nextValue,
      });
      refreshMenuCommands();
    },
    {
      id: MENU_IDS.delay,
      title: "每次请求完成后的等待时间",
    }
  );

  GM_registerMenuCommand(
    "重置请求设置",
    () => {
      resetRequestControlSettings();
      refreshMenuCommands();
    },
    {
      id: MENU_IDS.reset,
      title: `恢复默认：并发 ${DEFAULT_REQUEST_CONTROL_SETTINGS.concurrency}，间隔 ${DEFAULT_REQUEST_CONTROL_SETTINGS.requestDelayMs} ms`,
    }
  );
}

export function initMenu(): void {
  refreshMenuCommands();
}
