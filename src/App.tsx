import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  type Lang,
  getStoredLang,
  setStoredLang,
  t,
  formatSize,
} from "./i18n";
import {
  type BgType,
  type BgGradient,
  defaultGradient,
  getBackgroundStyle,
  getGradientDirections,
} from "./background";
import {
  type Workspace,
  getStoredCurrentWorkspaceId,
  setStoredCurrentWorkspaceId,
} from "./workspace";

interface Clip {
  id: number;
  content: string;
  created_at: string;
}

const POLL_MS = 2000;
const MIN_PREVIEW_LENGTH = 116; // hover preview only for content length > 115

function byteSize(str: string): number {
  return new TextEncoder().encode(str).length;
}

function workspaceToBg(ws: Workspace | null): {
  bgType: BgType;
  gradient: BgGradient;
  imageUrl: string;
} {
  if (!ws) {
    return {
      bgType: "default",
      gradient: { ...defaultGradient },
      imageUrl: "",
    };
  }
  let gradient: BgGradient = { ...defaultGradient };
  if (ws.bg_gradient) {
    try {
      const p = JSON.parse(ws.bg_gradient) as BgGradient;
      if (p.color1 && p.color2 && p.direction) gradient = p;
    } catch {
      // ignore
    }
  }
  const bgType: BgType =
    ws.bg_type === "gradient" || ws.bg_type === "image" ? ws.bg_type : "default";
  return {
    bgType,
    gradient,
    imageUrl: ws.bg_image_url ?? "",
  };
}

async function syncClipboard(
  ref: { current: string },
  workspaceId: number,
  refresh: () => void
) {
  try {
    const text = (await readText())?.trim() ?? "";
    if (!text || text === ref.current) return;
    await invoke("add_clip", { content: text, workspaceId });
    ref.current = text;
    refresh();
  } catch {
    // ignore
  }
}

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<number>(
    getStoredCurrentWorkspaceId
  );
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [lang, setLang] = useState<Lang>(getStoredLang);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const { bgType, gradient, imageUrl } = workspaceToBg(currentWorkspace);
  const [bgTypeEdit, setBgTypeEdit] = useState<BgType>(bgType);
  const [gradientEdit, setGradientEdit] = useState<BgGradient>(gradient);
  const [imageUrlEdit, setImageUrlEdit] = useState(imageUrl);
  const [hoverPreview, setHoverPreview] = useState<{
    content: string;
    top: number;
    left: number;
  } | null>(null);
  const [shortcutEdit, setShortcutEdit] = useState("");
  const [yomemoApiKey, setYomemoApiKey] = useState("");
  const [yomemoPemPath, setYomemoPemPath] = useState("");
  const [yomemoStatus, setYomemoStatus] = useState("");
  const [yomemoMe, setYomemoMe] = useState<{
    id: string;
    email: string;
    name: string;
    avatar: string;
    pro: boolean;
  } | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [yomemoAutoSync, setYomemoAutoSync] = useState(false);
  const [avatarTooltipVisible, setAvatarTooltipVisible] = useState(false);
  const [yomemoConfigured, setYomemoConfigured] = useState(false);
  const lastAddedRef = useRef<string>("");
  const hidePreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const shortcutRef = useRef<string | null>(null);

  const selectPemFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PEM Key File", extensions: ["pem"] }],
      });
      if (typeof selected === "string") {
        setYomemoPemPath(selected);
      }
    } catch (err) {
      setYomemoStatus(`Error selecting file: ${err}`);
    }
  }, []);

  const refreshYomemoMe = useCallback(() => {
    setAvatarLoadFailed(false);
    invoke<{ id: string; email: string; name: string; avatar: string; pro: boolean } | null>("get_yomemo_me")
      .then((me) => setYomemoMe(me ?? null))
      .catch(() => setYomemoMe(null));
  }, []);

  const configureYomemo = useCallback(async () => {
    setYomemoStatus("Saving...");
    try {
      await invoke("configure_yomemo", {
        apiKey: yomemoApiKey,
        pemPath: yomemoPemPath,
      });
      setYomemoStatus("Configuration saved successfully!");
      setYomemoConfigured(true);
      refreshYomemoMe();
    } catch (err) {
      setYomemoStatus(`Error: ${err}`);
    }
  }, [yomemoApiKey, yomemoPemPath, refreshYomemoMe]);

  const testYomemoSync = useCallback(async () => {
    setYomemoStatus("Syncing...");
    setAvatarLoadFailed(false);
    try {
      const me = await invoke<{ id: string; email: string; name: string; avatar: string; pro: boolean }>("trigger_yomemo_sync");
      setYomemoMe(me);
      setYomemoStatus("Sync test completed successfully!");
    } catch (err) {
      setYomemoStatus(`Error: ${err}`);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    invoke<string>("get_shortcut")
      .then(async (shortcut) => {
        if (!mounted) return;
        try {
          await unregister(shortcut).catch(() => {});
          await register(shortcut, (event) => {
            if (event.state === "Pressed") {
              invoke("toggle_main_window").catch(() => {});
            }
          });
          shortcutRef.current = shortcut;
        } catch {
          // ignore
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const refreshWorkspaces = useCallback(() => {
    invoke<Workspace[]>("get_workspaces").then(setWorkspaces).catch(() => setWorkspaces([]));
  }, []);

  const refreshCurrentWorkspace = useCallback(() => {
    invoke<Workspace | null>("get_workspace", { id: currentWorkspaceId })
      .then((w) => {
        setCurrentWorkspace(w ?? null);
        if (w) {
          const bg = workspaceToBg(w);
          setBgTypeEdit(bg.bgType);
          setGradientEdit(bg.gradient);
          setImageUrlEdit(bg.imageUrl);
        }
      })
      .catch(() => setCurrentWorkspace(null));
  }, [currentWorkspaceId]);

  const refreshClips = useCallback(() => {
    invoke<Clip[]>("get_clips", { workspaceId: currentWorkspaceId })
      .then(setClips)
      .catch(() => setClips([]));
  }, [currentWorkspaceId]);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    invoke<boolean>("get_yomemo_auto_sync").then(setYomemoAutoSync).catch(() => {});
    invoke<{ api_key: string; pem_path: string } | null>("get_yomemo_config")
      .then((cfg) => {
        if (cfg?.api_key?.trim()) {
          setYomemoConfigured(true);
          refreshYomemoMe();
        }
      })
      .catch(() => {});
  }, [refreshYomemoMe]);

  useEffect(() => {
    if (settingsOpen) {
      invoke<string>("get_shortcut").then(setShortcutEdit).catch(() => {});
      invoke<{ api_key: string; pem_path: string } | null>("get_yomemo_config")
        .then((cfg) => {
          if (cfg) {
            setYomemoApiKey(cfg.api_key);
            setYomemoPemPath(cfg.pem_path);
            setYomemoConfigured(true);
          }
        })
        .catch(() => {});
      refreshYomemoMe();
    }
  }, [settingsOpen, refreshYomemoMe]);

  const applyShortcut = useCallback(async () => {
    const s = shortcutEdit.trim();
    if (!s || s === shortcutRef.current) return;
    try {
      if (shortcutRef.current) {
        await unregister(shortcutRef.current);
      }
      await invoke("set_shortcut", { shortcut: s });
      await unregister(s).catch(() => {});
      await register(s, (event) => {
        if (event.state === "Pressed") {
          invoke("toggle_main_window").catch(() => {});
        }
      });
      shortcutRef.current = s;
    } catch {
      // ignore
    }
  }, [shortcutEdit]);

  useEffect(() => {
    if (workspaces.length > 0 && !workspaces.some((w) => w.id === currentWorkspaceId)) {
      setCurrentWorkspaceId(1);
      setStoredCurrentWorkspaceId(1);
    }
  }, [workspaces, currentWorkspaceId]);

  useEffect(() => {
    setStoredCurrentWorkspaceId(currentWorkspaceId);
    refreshCurrentWorkspace();
    refreshClips();
  }, [currentWorkspaceId, refreshCurrentWorkspace, refreshClips]);

  useEffect(() => {
    syncClipboard(lastAddedRef, currentWorkspaceId, refreshClips);
    const id = setInterval(
      () => syncClipboard(lastAddedRef, currentWorkspaceId, refreshClips),
      POLL_MS
    );
    return () => clearInterval(id);
  }, [currentWorkspaceId, refreshClips]);

  useEffect(() => {
    if (!yomemoAutoSync) return;
    const syncInterval = 5 * 60 * 1000;
    const runSync = () => {
      invoke("trigger_yomemo_sync")
        .then((me) => setYomemoMe(me))
        .catch(() => {});
    };
    runSync();
    const id = setInterval(runSync, syncInterval);
    return () => clearInterval(id);
  }, [yomemoAutoSync]);

  useEffect(() => {
    if (clips[0]?.content) lastAddedRef.current = clips[0].content;
  }, [clips]);

  const switchWorkspace = useCallback((id: number) => {
    setCurrentWorkspaceId(id);
    setWorkspacePanelOpen(false);
  }, []);

  const addWorkspace = useCallback(async () => {
    const name = newWorkspaceName.trim() || t(lang, "workspaceDefaultName");
    try {
      const w = await invoke<Workspace>("create_workspace", {
        name,
        description: "",
        icon: "📁",
      });
      setWorkspaces((prev) => [...prev, w]);
      setNewWorkspaceName("");
      setCurrentWorkspaceId(w.id);
      setWorkspacePanelOpen(false);
    } catch {
      // ignore
    }
  }, [newWorkspaceName, lang]);

  const updateWorkspaceBg = useCallback(
    async (updates: {
      bg_type?: BgType;
      bg_gradient?: BgGradient;
      bg_image_url?: string;
    }) => {
      try {
        await invoke("update_workspace", {
          id: currentWorkspaceId,
          input: {
            bg_type: updates.bg_type,
            bg_gradient: updates.bg_gradient
              ? JSON.stringify(updates.bg_gradient)
              : undefined,
            bg_image_url: updates.bg_image_url,
          },
        });
        refreshCurrentWorkspace();
      } catch {
        // ignore
      }
    },
    [currentWorkspaceId, refreshCurrentWorkspace]
  );

  const updateWorkspaceMeta = useCallback(
    async (updates: { name?: string; description?: string; icon?: string; read_only?: boolean }) => {
      try {
        await invoke("update_workspace", {
          id: currentWorkspaceId,
          input: updates,
        });
        refreshCurrentWorkspace();
        refreshWorkspaces();
      } catch {
        // ignore
      }
    },
    [currentWorkspaceId, refreshCurrentWorkspace, refreshWorkspaces]
  );

  const copyAndHide = useCallback(async (content: string) => {
    await writeText(content);
    getCurrentWindow().hide();
  }, []);

  const deleteOne = useCallback(
    async (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      await invoke("delete_clip", { id });
      refreshClips();
    },
    [refreshClips]
  );

  const clearAll = useCallback(async () => {
    await invoke("clear_clips", { workspaceId: currentWorkspaceId });
    lastAddedRef.current = "";
    refreshClips();
  }, [currentWorkspaceId, refreshClips]);

  const toggleLang = useCallback(() => {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setStoredLang(next);
    setLang(next);
  }, [lang]);

  const showPreview = useCallback(
    (e: React.MouseEvent<HTMLLIElement>, content: string) => {
      if (content.length < MIN_PREVIEW_LENGTH) return;
      if (hidePreviewTimeoutRef.current) {
        clearTimeout(hidePreviewTimeoutRef.current);
        hidePreviewTimeoutRef.current = null;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      setHoverPreview({
        content,
        top: rect.bottom + 4,
        left: rect.left,
      });
    },
    []
  );

  const HIDE_DELAY_MS = 60;

  const hidePreview = useCallback(() => {
    hidePreviewTimeoutRef.current = setTimeout(() => {
      setHoverPreview(null);
      hidePreviewTimeoutRef.current = null;
    }, HIDE_DELAY_MS);
  }, []);

  const hidePreviewNow = useCallback(() => {
    if (hidePreviewTimeoutRef.current) {
      clearTimeout(hidePreviewTimeoutRef.current);
      hidePreviewTimeoutRef.current = null;
    }
    setHoverPreview(null);
  }, []);

  const cancelHidePreview = useCallback(() => {
    if (hidePreviewTimeoutRef.current) {
      clearTimeout(hidePreviewTimeoutRef.current);
      hidePreviewTimeoutRef.current = null;
    }
  }, []);

  const applyBgType = useCallback(
    (type: BgType) => {
      setBgTypeEdit(type);
      updateWorkspaceBg({ bg_type: type });
    },
    [updateWorkspaceBg]
  );

  const applyGradient = useCallback(
    (g: BgGradient) => {
      setGradientEdit(g);
      updateWorkspaceBg({ bg_gradient: g });
    },
    [updateWorkspaceBg]
  );

  const applyImageUrl = useCallback(
    (url: string) => {
      setImageUrlEdit(url);
      updateWorkspaceBg({ bg_image_url: url });
    },
    [updateWorkspaceBg]
  );

  const onImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        applyImageUrl(dataUrl);
        applyBgType("image");
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [applyImageUrl, applyBgType]
  );

  const resetBackground = useCallback(() => {
    setBgTypeEdit("default");
    setGradientEdit({ ...defaultGradient });
    setImageUrlEdit("");
    updateWorkspaceBg({
      bg_type: "default",
      bg_gradient: defaultGradient,
      bg_image_url: "",
    });
  }, [updateWorkspaceBg]);

  const appBgStyle = getBackgroundStyle(bgType, gradient, imageUrl);
  const currentWs = workspaces.find((w) => w.id === currentWorkspaceId);
  const isReadOnly = Boolean(currentWorkspace?.read_only);

  return (
    <div className="app-wrap" style={appBgStyle}>
      <header className="header">
        <button
          type="button"
          className="header-workspace-trigger"
          onClick={() => setWorkspacePanelOpen((o) => !o)}
          title={t(lang, "switchWorkspace")}
        >
          <span className="header-workspace-icon">
            {currentWs?.icon ?? "📋"}
          </span>
          <span className="header-workspace-name">
            {currentWs?.name ?? t(lang, "title")}
          </span>
          <span className="header-workspace-chevron">
            {workspacePanelOpen ? "▴" : "▾"}
          </span>
        </button>
        <div className="header-actions">
          {(yomemoMe || yomemoConfigured) && (
            <div
              className="header-avatar-wrap"
              onMouseEnter={() => setAvatarTooltipVisible(true)}
              onMouseLeave={() => setAvatarTooltipVisible(false)}
            >
              {yomemoMe ? (
                <>
                  <div className={`header-avatar-container ${yomemoMe.pro ? "header-avatar-pro" : ""}`} title={yomemoMe.pro ? "Pro" : undefined}>
                    {yomemoMe.avatar && !avatarLoadFailed ? (
                      <img
                        src={yomemoMe.avatar}
                        alt=""
                        className="header-avatar"
                        onError={() => setAvatarLoadFailed(true)}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="header-avatar-initial">
                        {yomemoMe.name?.charAt(0) || yomemoMe.email?.charAt(0) || "?"}
                      </div>
                    )}
                  </div>
                  {avatarTooltipVisible && (
                    <div className="header-avatar-tooltip">
                      <div className="header-avatar-tooltip-name">{yomemoMe.name || yomemoMe.email}</div>
                      <div className="header-avatar-tooltip-email">{yomemoMe.email}</div>
                      {yomemoMe.pro && <span className="header-avatar-tooltip-pro">PRO</span>}
                    </div>
                  )}
                </>
              ) : (
                <div className="header-avatar-initial" title="YoMemo configured">✓</div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-icon"
            onClick={() => setSettingsOpen((o) => !o)}
            title={t(lang, "settings")}
            aria-label={t(lang, "settings")}
          >
            ⚙
          </button>
          <button
            type="button"
            className="btn-lang"
            onClick={toggleLang}
            title={lang === "zh" ? "Switch to English" : "切换到中文"}
          >
            {t(lang, "langToggle")}
          </button>
          {!isReadOnly && clips.length > 0 && (
            <button type="button" className="btn-clear" onClick={clearAll}>
              {t(lang, "clear")}
            </button>
          )}
        </div>
      </header>
      {workspacePanelOpen && (
        <section className="workspace-panel">
          <div className="workspace-panel-head">
            {t(lang, "workspaces")}
          </div>
          <ul className="workspace-list">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  className={`workspace-item ${w.id === currentWorkspaceId ? "active" : ""}`}
                  onClick={() => switchWorkspace(w.id)}
                >
                  <span className="workspace-item-icon">{w.icon}</span>
                  <span className="workspace-item-name">{w.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="workspace-add">
            <input
              type="text"
              className="workspace-add-input"
              placeholder={t(lang, "workspaceNewPlaceholder")}
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWorkspace()}
            />
            <button
              type="button"
              className="btn-add"
              onClick={addWorkspace}
            >
              {t(lang, "workspaceAdd")}
            </button>
          </div>
        </section>
      )}
      {currentWorkspace?.description && (
        <div className="workspace-desc">{currentWorkspace.description}</div>
      )}
      {settingsOpen && (
        <section className="settings-panel">
          <div className="settings-head">{t(lang, "shortcut")}</div>
          <div className="settings-row">
            <span>{t(lang, "shortcutLabel")}</span>
            <input
              type="text"
              className="settings-workspace-input"
              value={shortcutEdit}
              onChange={(e) => setShortcutEdit(e.target.value)}
              onBlur={applyShortcut}
              onKeyDown={(e) => e.key === "Enter" && applyShortcut()}
              placeholder={t(lang, "shortcutPlaceholder")}
              aria-label={t(lang, "shortcutLabel")}
            />
          </div>
          <div className="settings-head">Yomemo.ai Sync</div>
          {yomemoMe && (
            <div className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              {yomemoMe.avatar && !avatarLoadFailed ? (
                <img
                  src={yomemoMe.avatar}
                  alt=""
                  style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                  onError={() => setAvatarLoadFailed(true)}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2em' }}>
                  {yomemoMe.name?.charAt(0) || yomemoMe.email?.charAt(0) || '?'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {yomemoMe.name || yomemoMe.email}
                </div>
                <div style={{ fontSize: '0.85em', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {yomemoMe.email}
                </div>
              </div>
              {yomemoMe.pro && (
                <span style={{ fontSize: '0.75em', padding: '2px 8px', borderRadius: 4, background: 'var(--accent)', color: 'var(--bg-primary)' }}>
                  PRO
                </span>
              )}
            </div>
          )}
          <div className="settings-row">
            <span>API Key</span>
            <input
              type="password"
              className="settings-workspace-input"
              placeholder="Your Yomemo.ai API Key"
              value={yomemoApiKey}
              onChange={(e) => setYomemoApiKey(e.target.value)}
            />
          </div>
          <div className="settings-row" style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ flexShrink: 0, marginRight: '8px' }}>PEM Path</span>
            <input
              type="text"
              className="settings-workspace-input"
              style={{ flexGrow: 1 }}
              placeholder="Path to your PEM private key file"
              value={yomemoPemPath}
              onChange={(e) => setYomemoPemPath(e.target.value)}
            />
            <button type="button" onClick={selectPemFile} style={{ marginLeft: '8px' }}>
              Browse...
            </button>
          </div>
          <div className="settings-row">
              <button type="button" onClick={configureYomemo}>
                  Save Configuration
              </button>
              <button type="button" onClick={testYomemoSync} style={{ marginLeft: '8px' }}>
                  Run Sync Test
              </button>
          </div>
          {yomemoMe && (
            <div className="settings-row settings-row-checkbox">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={yomemoAutoSync}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setYomemoAutoSync(v);
                    invoke("set_yomemo_auto_sync", { enabled: v }).catch(() => {});
                  }}
                />
                <span>{lang === "zh" ? "自动同步" : "Auto sync"}</span>
              </label>
              <span style={{ fontSize: '0.75em', opacity: 0.7, marginLeft: '0.5rem' }}>
                {lang === "zh" ? "每 5 分钟同步到云端" : "Every 5 min"}
              </span>
            </div>
          )}
          {yomemoStatus && <div className="settings-row" style={{ fontSize: '0.8em', opacity: 0.8 }}>{yomemoStatus}</div>}
          <div className="settings-head">{t(lang, "currentWorkspace")}</div>
          <div className="settings-workspace-meta">
            <div className="settings-row">
              <span>{t(lang, "workspaceName")}</span>
              <input
                ref={nameInputRef}
                type="text"
                className="settings-workspace-input"
                key={currentWorkspaceId}
                defaultValue={currentWorkspace?.name ?? ""}
                onBlur={() => {
                  const v = nameInputRef.current?.value.trim() ?? "";
                  if (v && v !== currentWorkspace?.name)
                    updateWorkspaceMeta({ name: v });
                }}
              />
            </div>
            <div className="settings-row">
              <span>{t(lang, "workspaceDesc")}</span>
              <input
                ref={descInputRef}
                type="text"
                className="settings-workspace-input"
                placeholder={t(lang, "workspaceDescPlaceholder")}
                key={currentWorkspaceId}
                defaultValue={currentWorkspace?.description ?? ""}
                onBlur={() => {
                  const v = descInputRef.current?.value.trim() ?? "";
                  if (v !== (currentWorkspace?.description ?? ""))
                    updateWorkspaceMeta({ description: v });
                }}
              />
            </div>
            <div className="settings-row">
              <span>{t(lang, "workspaceIcon")}</span>
              <input
                type="text"
                className="settings-workspace-icon-input"
                value={currentWorkspace?.icon ?? "📋"}
                onChange={(e) =>
                  updateWorkspaceMeta({ icon: e.target.value || "📋" })
                }
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={t(lang, "workspaceIcon")}
              />
              <div className="settings-workspace-icon-picker">
                {["📋", "📁", "📌", "✏️", "🗂️", "📎", "⭐", "🔖"].map(
                  (emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      title={emoji}
                      className={
                        (currentWorkspace?.icon ?? "📋") === emoji
                          ? "active"
                          : ""
                      }
                      onClick={() => updateWorkspaceMeta({ icon: emoji })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {emoji}
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="settings-row settings-row-checkbox">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={currentWorkspace?.read_only ?? false}
                  onChange={(e) =>
                    updateWorkspaceMeta({ read_only: e.target.checked })
                  }
                />
                <span>{t(lang, "workspaceReadOnly")}</span>
              </label>
            </div>
          </div>
          <div className="settings-head">{t(lang, "background")}</div>
          <div className="settings-options">
            <label className="settings-radio">
              <input
                type="radio"
                name="bg"
                checked={bgTypeEdit === "default"}
                onChange={() => applyBgType("default")}
              />
              <span>{t(lang, "bgDefault")}</span>
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="bg"
                checked={bgTypeEdit === "gradient"}
                onChange={() => applyBgType("gradient")}
              />
              <span>{t(lang, "bgGradient")}</span>
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="bg"
                checked={bgTypeEdit === "image"}
                onChange={() => applyBgType("image")}
              />
              <span>{t(lang, "bgImage")}</span>
            </label>
          </div>
          {bgTypeEdit === "gradient" && (
            <div className="settings-gradient">
              <div className="settings-row">
                <span>{t(lang, "color1")}</span>
                <input
                  type="color"
                  value={gradientEdit.color1}
                  onChange={(e) =>
                    applyGradient({ ...gradientEdit, color1: e.target.value })
                  }
                />
                <input
                  type="text"
                  className="settings-hex"
                  value={gradientEdit.color1}
                  onChange={(e) =>
                    applyGradient({ ...gradientEdit, color1: e.target.value })
                  }
                />
              </div>
              <div className="settings-row">
                <span>{t(lang, "color2")}</span>
                <input
                  type="color"
                  value={gradientEdit.color2}
                  onChange={(e) =>
                    applyGradient({ ...gradientEdit, color2: e.target.value })
                  }
                />
                <input
                  type="text"
                  className="settings-hex"
                  value={gradientEdit.color2}
                  onChange={(e) =>
                    applyGradient({ ...gradientEdit, color2: e.target.value })
                  }
                />
              </div>
              <div className="settings-row">
                <span>{t(lang, "direction")}</span>
                <select
                  value={gradientEdit.direction}
                  onChange={(e) =>
                    applyGradient({ ...gradientEdit, direction: e.target.value })
                  }
                >
                  {getGradientDirections().map((d) => (
                    <option key={d.value} value={d.value}>
                      {lang === "zh" ? d.labelZh : d.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {bgTypeEdit === "image" && (
            <div className="settings-image">
              <div className="settings-row">
                <label className="btn-browse">
                  {t(lang, "chooseFile")}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onImageFileChange}
                    hidden
                  />
                </label>
              </div>
              <div className="settings-row">
                <input
                  type="text"
                  className="settings-url"
                  placeholder={
                    imageUrlEdit.startsWith("data:")
                      ? t(lang, "imageUrlPlaceholder")
                      : t(lang, "imageUrl")
                  }
                  value={imageUrlEdit.startsWith("data:") ? "" : imageUrlEdit}
                  onChange={(e) => applyImageUrl(e.target.value)}
                />
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn-reset"
            onClick={resetBackground}
          >
            {t(lang, "reset")}
          </button>
        </section>
      )}
      <ul className="clip-list" aria-hidden={settingsOpen}>
        {clips.length === 0 ? (
          <li className="empty">{t(lang, "empty")}</li>
        ) : (
          clips.map((c) => (
            <li
              key={c.id}
              className="clip-item"
              onClick={() => copyAndHide(c.content)}
              onMouseEnter={(e) => showPreview(e, c.content)}
              onMouseLeave={hidePreview}
            >
              <span className="clip-text">
                {c.content.slice(0, 120)}
                {c.content.length > 120 ? "…" : ""}
              </span>
              {!isReadOnly && (
                <button
                  type="button"
                  className="btn-delete"
                  title={t(lang, "delete")}
                  onClick={(e) => deleteOne(e, c.id)}
                  aria-label={t(lang, "delete")}
                >
                  ×
                </button>
              )}
            </li>
          ))
        )}
      </ul>
      {hoverPreview && (
        <div
          className="clip-preview"
          style={{
            top: hoverPreview.top,
            left: hoverPreview.left,
          }}
          onMouseEnter={cancelHidePreview}
          onMouseLeave={hidePreviewNow}
        >
          <pre className="clip-preview-content">{hoverPreview.content}</pre>
          <div className="clip-preview-size">
            {formatSize(
              lang,
              hoverPreview.content.length,
              byteSize(hoverPreview.content)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
