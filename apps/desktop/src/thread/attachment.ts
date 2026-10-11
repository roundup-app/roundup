/** `size` and `url` are `null` for a native drop (U199), which gives the Thread a path and no bytes. */
export type Attachment = { id: number; name: string; size: number | null; url: string | null };

const isImage = (file: File): boolean => file.type.startsWith("image/");

/** `812 B`, `12 KB`, `3.4 MB`: the size an Attachment shows beside its name. */
export const sizeText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** The files of a paste or a drop: `ok` are images, `refused` are the names of the rest. */
export const sortFiles = (files: Iterable<File>) => {
  const ok: File[] = [];
  const refused: string[] = [];

  for (const file of files) {
    if (isImage(file)) ok.push(file);
    else refused.push(file.name);
  }

  return { ok, refused };
};

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|heic)$/i;

/** U199: a native drop reports paths; the last segment names it, and only an image name is accepted. */
export const sortPaths = (paths: readonly string[]) => {
  const ok: string[] = [];
  const refused: string[] = [];

  for (const path of paths) {
    const name = path.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? path;

    if (IMAGE_PATH.test(name)) ok.push(name);
    else refused.push(name);
  }

  return { ok, refused };
};

/** U199: the image Files of a paste, from `files` or, as WebKit gives a screenshot, from `items`. */
export const pastedFiles = (data: DataTransfer | null | undefined): File[] => {
  if (!data) return [];

  const files = [...(data.files ?? [])];

  if (files.length > 0) return files;

  return [...(data.items ?? [])].flatMap((item) => {
    const file = item.kind === "file" && item.type.startsWith("image/") ? item.getAsFile() : null;

    return file ? [file] : [];
  });
};

/** U199: a paste of more than 3 lines or 400 characters shows as a placeholder. */
export const isLongPaste = (text: string): boolean => text.length > 400 || text.split("\n").length > 3;

export const placeholderOf = (n: number, text: string): string => `[Pasted text #${n} +${text.split("\n").length - 1} lines]`;

/** U352: the absolute image paths of a Message body, in order; a path is a whitespace-free word that starts with `/`, or `X:\` or `X:/`, and ends in an image extension. */
export const imagePaths = (body: string): string[] =>
  body.split(/\s+/).filter((word) => /^(\/|[A-Za-z]:[\\/])/.test(word) && IMAGE_PATH.test(word));

/** U352: the file name of an image path, the `alt` of its image. */
export const imageName = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;
