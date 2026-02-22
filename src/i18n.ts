export type Lang = "zh" | "en";

const LANG_KEY = "smart-clip-lang";

export function getStoredLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    // ignore
  }
  return "zh";
}

export function setStoredLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}

const strings: Record<Lang, Record<string, string>> = {
  zh: {
    title: "剪贴板历史",
    clear: "清空",
    empty: "复制内容后会自动出现在这里",
    delete: "删除",
    chars: "字符",
    bytes: "字节",
    langToggle: "EN",
    settings: "设置",
    background: "背景",
    bgDefault: "默认",
    bgGradient: "渐变",
    bgImage: "背景图",
    color1: "颜色一",
    color2: "颜色二",
    direction: "方向",
    imageUrl: "图片地址",
    imageUrlPlaceholder: "已选择本地图片（可输入网络地址）",
    chooseFile: "选择本地图片",
    reset: "恢复默认",
    workspaces: "工作区",
    switchWorkspace: "切换工作区",
    workspaceDefaultName: "新工作区",
    workspaceNewPlaceholder: "例如：日常任务",
    workspaceAdd: "添加",
    currentWorkspace: "当前工作区",
    workspaceName: "名称",
    workspaceDesc: "描述",
    workspaceDescPlaceholder: "可选，如：日常任务剪贴",
    workspaceIcon: "图标",
  },
  en: {
    title: "Clipboard",
    clear: "Clear",
    empty: "Copied content will appear here",
    delete: "Delete",
    chars: "chars",
    bytes: "bytes",
    langToggle: "中",
    settings: "Settings",
    background: "Background",
    bgDefault: "Default",
    bgGradient: "Gradient",
    bgImage: "Image",
    color1: "Color 1",
    color2: "Color 2",
    direction: "Direction",
    imageUrl: "Image URL",
    imageUrlPlaceholder: "Local image selected (or enter URL)",
    chooseFile: "Choose local image",
    reset: "Reset",
    workspaces: "Workspaces",
    switchWorkspace: "Switch workspace",
    workspaceDefaultName: "New workspace",
    workspaceNewPlaceholder: "e.g. Daily tasks",
    workspaceAdd: "Add",
    currentWorkspace: "Current workspace",
    workspaceName: "Name",
    workspaceDesc: "Description",
    workspaceDescPlaceholder: "Optional, e.g. Daily task clips",
    workspaceIcon: "Icon",
  },
};

export function t(lang: Lang, key: keyof typeof strings.zh): string {
  return strings[lang][key] ?? strings.zh[key];
}

export function formatSize(lang: Lang, chars: number, bytes: number): string {
  const c = t(lang, "chars");
  const b = t(lang, "bytes");
  return `${chars.toLocaleString()} ${c} · ${bytes.toLocaleString()} ${b}`;
}
