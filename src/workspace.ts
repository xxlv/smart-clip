const KEY_CURRENT_WORKSPACE_ID = "smart-clip-current-workspace-id";

export interface Workspace {
  id: number;
  name: string;
  description: string;
  icon: string;
  bg_type: string;
  bg_gradient: string | null;
  bg_image_url: string;
  sort_order: number;
  created_at: string;
}

export function getStoredCurrentWorkspaceId(): number {
  try {
    const v = localStorage.getItem(KEY_CURRENT_WORKSPACE_ID);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  } catch {
    // ignore
  }
  return 1;
}

export function setStoredCurrentWorkspaceId(id: number): void {
  try {
    localStorage.setItem(KEY_CURRENT_WORKSPACE_ID, String(id));
  } catch {
    // ignore
  }
}
