const KEY_TYPE = "smart-clip-bg-type";
const KEY_GRADIENT = "smart-clip-bg-gradient";
const KEY_IMAGE = "smart-clip-bg-image";

export type BgType = "default" | "gradient" | "image";

export interface BgGradient {
  color1: string;
  color2: string;
  direction: string;
}

const GRADIENT_DIRECTIONS: { value: string; labelZh: string; labelEn: string }[] = [
  { value: "to bottom", labelZh: "自上而下", labelEn: "Top to bottom" },
  { value: "to top", labelZh: "自下而上", labelEn: "Bottom to top" },
  { value: "to right", labelZh: "自左而右", labelEn: "Left to right" },
  { value: "to left", labelZh: "自右而左", labelEn: "Right to left" },
  { value: "135deg", labelZh: "对角 135°", labelEn: "Diagonal 135°" },
  { value: "45deg", labelZh: "对角 45°", labelEn: "Diagonal 45°" },
];

export function getGradientDirections(): typeof GRADIENT_DIRECTIONS {
  return GRADIENT_DIRECTIONS;
}

export const defaultGradient: BgGradient = {
  color1: "#f0f4f8",
  color2: "#e2e8f0",
  direction: "to bottom",
};

export function getStoredBgType(): BgType {
  try {
    const v = localStorage.getItem(KEY_TYPE);
    if (v === "gradient" || v === "image") return v;
  } catch {
    // ignore
  }
  return "default";
}

export function setStoredBgType(type: BgType): void {
  try {
    localStorage.setItem(KEY_TYPE, type);
  } catch {
    // ignore
  }
}

export function getStoredGradient(): BgGradient {
  try {
    const v = localStorage.getItem(KEY_GRADIENT);
    if (v) {
      const parsed = JSON.parse(v) as BgGradient;
      if (parsed.color1 && parsed.color2 && parsed.direction) return parsed;
    }
  } catch {
    // ignore
  }
  return { ...defaultGradient };
}

export function setStoredGradient(g: BgGradient): void {
  try {
    localStorage.setItem(KEY_GRADIENT, JSON.stringify(g));
  } catch {
    // ignore
  }
}

export function getStoredImageUrl(): string {
  try {
    return localStorage.getItem(KEY_IMAGE) ?? "";
  } catch {
    return "";
  }
}

export function setStoredImageUrl(url: string): void {
  try {
    if (url) localStorage.setItem(KEY_IMAGE, url);
    else localStorage.removeItem(KEY_IMAGE);
  } catch {
    // ignore
  }
}

export function getBackgroundStyle(
  type: BgType,
  gradient: BgGradient,
  imageUrl: string
): React.CSSProperties {
  if (type === "default") {
    return { background: "#f6f6f6" };
  }
  if (type === "gradient") {
    const dir = gradient.direction.startsWith("deg") ? gradient.direction : gradient.direction;
    return {
      background: `linear-gradient(${dir}, ${gradient.color1}, ${gradient.color2})`,
    };
  }
  if (type === "image" && imageUrl) {
    return {
      backgroundImage: `url(${imageUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    };
  }
  return { background: "#f6f6f6" };
}
