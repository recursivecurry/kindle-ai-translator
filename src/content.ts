const PAGE_CHECK_INTERVAL_MS = 150;
const state = globalThis as typeof globalThis & {
  kwLocalReaderInstalled?: boolean;
};
if (!state.kwLocalReaderInstalled) {
  state.kwLocalReaderInstalled = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "visible-page" || port.sender?.id !== chrome.runtime.id)
      return;
    let previous = "";
    let revision = 0;
    function snapshot() {
      const images = [
        ...document.querySelectorAll<HTMLImageElement>(".kg-full-page-img img"),
      ].filter((image) =>
        image.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
      );
      const regions = images
        .map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            x: Math.max(0, rect.left),
            y: Math.max(0, rect.top),
            width: Math.min(innerWidth, rect.right) - Math.max(0, rect.left),
            height: Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top),
          };
        })
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const signature = JSON.stringify([
        document.hidden,
        innerWidth,
        innerHeight,
        regions,
        images.map((image) => [
          image.currentSrc,
          image.complete,
          image.naturalWidth,
        ]),
      ]);
      if (signature !== previous) {
        previous = signature;
        revision++;
        port.postMessage({
          revision,
          regions: document.hidden ? [] : regions,
          viewport: { width: innerWidth, height: innerHeight },
        });
      }
    }
    snapshot();
    const timer = setInterval(snapshot, PAGE_CHECK_INTERVAL_MS);
    const observer = new MutationObserver(snapshot);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const invalidate = () => {
      previous = "";
      snapshot();
    };
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    document.addEventListener("visibilitychange", invalidate);
    window.addEventListener("pagehide", invalidate);
    port.onDisconnect.addListener(() => {
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
      document.removeEventListener("visibilitychange", invalidate);
      window.removeEventListener("pagehide", invalidate);
    });
  });
}
