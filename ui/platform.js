// Which computer the app is on, for the few places a Mac works differently (the ⌘ key, trackpad gestures, mouse side buttons).
export const isMac = typeof navigator !== 'undefined' && /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

/** The zoom keys in words: "⌘ + and ⌘ −" on a Mac, "Ctrl + and Ctrl −" elsewhere. */
export const zoomKeysText = (mac = isMac) => {
  const k = mac ? '⌘' : 'Ctrl';
  return `${k} + and ${k} − to zoom, ${k} 0 to reset.`;
};

/**
 * Mouse side buttons on a Mac: the system doesn't turn them into back / forward for the app (Windows and Linux do, see
 * 'app-command' in electron/main.js), so the page does it, the same as the arrows in the side menu.
 */
export function installMacMouseButtons(mac = isMac, target = typeof window !== 'undefined' ? window : null) {
  if (!mac || !target) return () => {};
  const onUp = e => {
    if (e.button === 3) { e.preventDefault(); history.back(); }
    else if (e.button === 4) { e.preventDefault(); history.forward(); }
  };
  target.addEventListener('mouseup', onUp);
  return () => target.removeEventListener('mouseup', onUp);
}
