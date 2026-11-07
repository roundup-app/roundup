let pixel: CanvasRenderingContext2D | null | undefined;

const canvas = () => {
  pixel ??= document.createElement("canvas").getContext("2d", { colorSpace: "srgb", willReadFrequently: true });

  return pixel;
};

/**
 * A Token's computed colour in a form colour parsers outside the browser read (hex, `rgb()`).
 * `color(display-p3 …)` goes through a 1×1 sRGB canvas, which maps it to the nearest sRGB colour.
 */
export const tokenColour = (name: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  if (!value.startsWith("color(")) return value;
  const context = canvas();

  if (!context) return value;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;

  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
};

