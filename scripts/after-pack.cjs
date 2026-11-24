// electron-builder afterPack hook: writes the FRISTY icon and version information into the
// Windows executable using the pure-JavaScript `resedit` library, so building the Windows
// installer on Linux/macOS does not need Wine. (On Windows the result is identical.)
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename } = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10) || 0);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(maj, min, pat, 0, 1033);
  vi.setProductVersion(maj, min, pat, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'FRISTY Cleaner',
    ProductName: 'FRISTY Cleaner',
    CompanyName: 'FRISTY',
    LegalCopyright: 'Copyright © 2026 FRISTY',
    InternalName: 'FRISTY Cleaner',
    OriginalFilename: `${productFilename}.exe`,
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • FRISTY: icon and version info written to ${path.basename(exePath)}`);
};
