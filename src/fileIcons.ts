interface Glyph {
  glyph: string;
  color: string;
}

const EXT_MAP: Record<string, Glyph> = {
  c: { glyph: "C", color: "#4a9eff" },
  h: { glyph: "H", color: "#8a8e93" },
  cpp: { glyph: "C+", color: "#4a9eff" },
  cc: { glyph: "C+", color: "#4a9eff" },
  cxx: { glyph: "C+", color: "#4a9eff" },
  hpp: { glyph: "H+", color: "#8a8e93" },
  hxx: { glyph: "H+", color: "#8a8e93" },
  ino: { glyph: "•", color: "#00979c" },
  py: { glyph: "PY", color: "#e5a13b" },
  ini: { glyph: "⚙", color: "#b183e0" },
  json: { glyph: "{}", color: "#e5a13b" },
  md: { glyph: "M↓", color: "#8a8e93" },
  txt: { glyph: "T", color: "#8a8e93" },
  yml: { glyph: "Y", color: "#b183e0" },
  yaml: { glyph: "Y", color: "#b183e0" },
  s: { glyph: "ASM", color: "#e5594f" },
  S: { glyph: "ASM", color: "#e5594f" },
  ld: { glyph: "LD", color: "#e5594f" },
  kconfig: { glyph: "K", color: "#4fc16a" },
};

// ESP-IDF project files are matched by exact name rather than extension —
// `sdkconfig`, `CMakeLists.txt`, and `Kconfig*` carry no (or a misleading)
// file extension.
const NAME_MAP: Record<string, Glyph> = {
  "cmakelists.txt": { glyph: "CM", color: "#5fb9e0" },
  sdkconfig: { glyph: "⚙", color: "#b183e0" },
  "sdkconfig.defaults": { glyph: "⚙", color: "#b183e0" },
  "sdkconfig.old": { glyph: "⚙", color: "#8a8e93" },
  kconfig: { glyph: "K", color: "#4fc16a" },
  "kconfig.projbuild": { glyph: "K", color: "#4fc16a" },
};

const DEFAULT_FILE: Glyph = { glyph: "•", color: "#8a8e93" };

export function fileGlyph(name: string): Glyph {
  const byName = NAME_MAP[name.toLowerCase()];
  if (byName) return byName;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT_MAP[ext] ?? DEFAULT_FILE;
}

const LANG_BY_EXT: Record<string, string> = {
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  ino: "cpp",
  py: "python",
  ini: "ini",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  txt: "plaintext",
};

const LANG_BY_NAME: Record<string, string> = {
  sdkconfig: "ini",
  "sdkconfig.defaults": "ini",
  "sdkconfig.old": "ini",
};

/** Only languages actually registered in editor.ts have real tokenizers;
 * everything else (json, cmake, asm, ...) renders as plain text. */
export function languageForFile(name: string): string {
  const byName = LANG_BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}
