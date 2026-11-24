// electron-builder afterPack hook. macOS only: seal the app with an ad-hoc signature (no certificate).
// Build changes (Info.plist, the app's files) break the signature Electron ships with, and an Apple Silicon Mac refuses to
// start an app with a broken signature ("is damaged"). Ad hoc is not a trusted signature: it only makes the seal consistent.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
