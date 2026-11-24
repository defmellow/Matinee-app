import test from 'node:test';
import assert from 'node:assert/strict';
import { usesTitleOverlay, iconFileFor, appDirFor, macMenuTemplate } from '../../electron/shell-util.js';

test('only Windows draws its own title strip; Mac and Linux keep the system frame', () => {
  assert.equal(usesTitleOverlay('win32'), true);
  assert.equal(usesTitleOverlay('darwin'), false);
  assert.equal(usesTitleOverlay('linux'), false);
});

test('window icon: .ico on Windows, .png elsewhere', () => {
  assert.equal(iconFileFor('win32'), 'matinee.ico');
  assert.equal(iconFileFor('linux'), 'matinee.png');
  assert.equal(iconFileFor('darwin'), 'matinee.png');
});

test('appDirFor: what Settings counts as Matinee itself on each system', () => {
  assert.equal(appDirFor({ platform: 'linux', env: {}, packaged: false }), null);
  assert.equal(appDirFor({ platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Matinee.exe' }, exe: 'C:\\tmp\\Matinee.exe', packaged: true }), 'D:\\Matinee.exe');
  assert.equal(appDirFor({ platform: 'win32', env: {}, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\Matinee\\Matinee.exe', packaged: true }), 'C:\\Users\\a\\AppData\\Local\\Programs\\Matinee');
  assert.equal(appDirFor({ platform: 'linux', env: { APPIMAGE: '/home/a/Matinee-1.AppImage' }, exe: '/tmp/.mount_x/matinee', packaged: true }), '/home/a/Matinee-1.AppImage');
  assert.equal(appDirFor({ platform: 'linux', env: {}, exe: '/opt/Matinee/matinee', packaged: true }), '/opt/Matinee');
  assert.equal(appDirFor({ platform: 'darwin', env: {}, exe: '/Applications/Matinee.app/Contents/MacOS/Matinee', packaged: true }), '/Applications/Matinee.app');
});

test('Mac menu: app, Edit (copy/paste work in text fields), View (zoom only), Window; no dev tools or reload', () => {
  const t = macMenuTemplate('Matinee');
  assert.deepEqual(t.map(m => m.label), ['Matinee', 'Edit', 'View', 'Window']);
  const roles = label => t.find(m => m.label === label).submenu.map(i => i.role).filter(Boolean);
  assert.deepEqual(roles('Edit'), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  assert.ok(roles('Matinee').includes('about') && roles('Matinee').includes('hide') && roles('Matinee').includes('quit'));
  assert.deepEqual(roles('View'), ['zoomIn', 'zoomOut', 'resetZoom', 'togglefullscreen']);
  const all = t.flatMap(m => m.submenu.map(i => i.role));
  assert.ok(!all.includes('toggleDevTools') && !all.includes('reload') && !all.includes('forceReload'));
});
