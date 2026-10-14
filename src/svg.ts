// An icon is a list of [tag, attributes] pairs, exactly as the Hugeicons packages ship it.
export type IconElement = [string, Record<string, string | number>];
export type IconData = IconElement[];

export type RenderOptions = {
  size?: number | undefined;
  color?: string | undefined;
  secondaryColor?: string | undefined;
  strokeWidth?: number | undefined;
};

const NUMBER = String.raw`(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg|rad|grad|turn)?|none)`;
const SEP = String.raw`(?:\s*,\s*|\s+)`;
const FUNCTION = String.raw`(?:rgba?|hsla?|oklch|oklab)\(\s*${NUMBER}${SEP}${NUMBER}${SEP}${NUMBER}(?:\s*[,/]\s*${NUMBER})?\s*\)`;

// Hex, a colour function with 3 or 4 numeric parts, currentColor or transparent; anything else could break out of the attribute or paint nothing.
export const COLOR_PATTERN = new RegExp(
  String.raw`^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|currentcolor|transparent|${FUNCTION})$`,
  "i",
);

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const toKebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Opacity marks the secondary layer; the official React renderer paints it first, so this does too.
function paintOrder(icon: IconData): IconData {
  const secondary = icon.filter(([, a]) => a.opacity !== undefined);
  const primary = icon.filter(([, a]) => a.opacity === undefined);
  return [...secondary, ...primary];
}

export function renderSvg(icon: IconData, options: RenderOptions = {}): string {
  const size = options.size ?? 24;
  const children = paintOrder(icon).map(([tag, attrs]) => {
    const isSecondary = attrs.opacity !== undefined;
    const paint = isSecondary ? (options.secondaryColor ?? options.color) : options.color;
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(attrs)) {
      if (key === "key") continue;
      let value = String(raw);
      if ((key === "fill" || key === "stroke") && value === "currentColor" && paint) value = paint;
      if (key === "strokeWidth" && options.strokeWidth !== undefined) value = String(options.strokeWidth);
      parts.push(`${toKebab(key)}="${escapeAttr(value)}"`);
    }
    return `<${tag} ${parts.join(" ")}/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">` +
    children.join("") +
    `</svg>`
  );
}
