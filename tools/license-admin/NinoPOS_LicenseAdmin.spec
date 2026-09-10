# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['D:/Projects/NinoPOS/tools/license-admin/license_admin.py'],
    pathex=['D:/Projects/NinoPOS/tools/license-generator'],
    binaries=[],
    datas=[('D:/Projects/NinoPOS/tools/license-generator/keys/ninotek_private.pem', 'keys'), ('D:/Projects/NinoPOS/tools/license-admin/LicenseAdmin.ico', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='NinoPOS_LicenseAdmin',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['D:/Projects/NinoPOS/tools/license-admin/LicenseAdmin.ico'],
)
