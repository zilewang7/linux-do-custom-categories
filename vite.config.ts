import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

function getUserscriptIcon(): string {
  const iconPath = fileURLToPath(new URL("./asset/icon.svg", import.meta.url));
  const svg = readFileSync(iconPath, "utf8");
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${encoded}`;
}

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "Linux Do 自定义类别",
        icon: getUserscriptIcon(),
        namespace: "ddc/linux-do-custom-categories",
        homepage: "https://github.com/zilewang7/linux-do-custom-categories",
        downloadURL:
          "https://update.greasyfork.org/scripts/563058/Linux%20Do%20%E8%87%AA%E5%AE%9A%E4%B9%89%E7%B1%BB%E5%88%AB.user.js",
        updateURL:
          "https://update.greasyfork.org/scripts/563058/Linux%20Do%20%E8%87%AA%E5%AE%9A%E4%B9%89%E7%B1%BB%E5%88%AB.meta.js",
        license: "MIT",
        match: ["https://linux.do/*"],
        description: "Linux Do Custom Categories",
        author: "DDC(NaiveMagic)",
        grant: [
          "GM_getValue",
          "GM_setValue",
          "GM_registerMenuCommand",
          "GM_unregisterMenuCommand",
        ],
      },
    }),
  ],
});
