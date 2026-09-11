import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { app, dialog, shell } from "electron";

export function resolveDevRepoRoot(mainDirname: string): string {
  return join(mainDirname, "../../../..");
}

export function loadApplicationEnv(mainDirname: string): void {
  const candidates = app.isPackaged
    ? [join(app.getPath("userData"), ".env")]
    : [join(resolveDevRepoRoot(mainDirname), ".env")];

  for (const candidate of candidates) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function ensureRuntimeConfig(): Promise<boolean> {
  if (!app.isPackaged) return true;

  const runtimeHome = app.getPath("userData");
  const configPath = join(runtimeHome, ".env");
  if (existsSync(configPath)) return true;

  await mkdir(runtimeHome, { recursive: true });
  const choice = await dialog.showMessageBox({
    type: "info",
    title: "配置 pi-ling",
    message: "首次启动需要环境配置文件。",
    detail:
      "可导入已有 .env，或在应用数据目录创建模板后填入 DEEPSEEK_API_KEY 等配置。",
    buttons: ["导入 .env", "创建模板并退出"],
    defaultId: 0,
    cancelId: 1,
  });

  if (choice.response === 0) {
    const selected = await dialog.showOpenDialog({
      title: "导入 pi-ling 环境文件",
      message: "选择包含 API 配置的 .env 文件",
      buttonLabel: "导入",
      properties: ["openFile", "showHiddenFiles"],
    });
    if (!selected.canceled && selected.filePaths[0]) {
      await copyFile(selected.filePaths[0], configPath);
      await chmod(configPath, 0o600);
      try {
        process.loadEnvFile(configPath);
      } catch (error) {
        await dialog.showMessageBox({
          type: "error",
          title: "配置无效",
          message: "导入的 .env 无法解析。",
          detail:
            error instanceof Error ? error.message : String(error),
          buttons: ["确定"],
        });
        return false;
      }
      return true;
    }
    await dialog.showMessageBox({
      type: "warning",
      title: "未导入配置",
      message: "未选择 .env 文件，pi-ling 无法启动。",
      detail: "请重新打开应用并导入包含 DEEPSEEK_API_KEY 的配置文件。",
      buttons: ["确定"],
    });
    return false;
  }

  const templatePath = join(process.resourcesPath, "config", ".env.example");
  await copyFile(templatePath, configPath);
  await chmod(configPath, 0o600);
  shell.showItemInFolder(configPath);
  await dialog.showMessageBox({
    type: "info",
    title: "已创建配置模板",
    message: "请填写环境文件后重新打开 pi-ling。",
    detail: configPath,
    buttons: ["确定"],
  });
  return false;
}
