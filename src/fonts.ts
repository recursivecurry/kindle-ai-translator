import { deadline, type Typography } from "./model";

const loadedFonts = new Map<string, Promise<void>>();
export function loadTranslationFont(
  family: Typography["family"],
): Promise<void> {
  const name = family === "serif" ? "KW Nanum Myeongjo" : "KW Nanum Gothic";
  const file =
    family === "serif"
      ? "NanumMyeongjo-Regular.ttf"
      : "NanumGothic-Regular.ttf";
  let loaded = loadedFonts.get(name);
  if (!loaded) {
    loaded = deadline(
      new FontFace(
        name,
        `url("${chrome.runtime.getURL(`fonts/${file}`)}")`,
      ).load(),
      10000,
      "한글 글꼴을 불러오지 못했습니다.",
    )
      .then((font) => {
        document.fonts.add(font);
      })
      .catch((error) => {
        loadedFonts.delete(name);
        throw error;
      });
    loadedFonts.set(name, loaded);
  }
  return loaded;
}
