import tomllib
from pathlib import Path

ROOT = Path(SPECPATH).parent
NAME = "SSH GUI"
VERSION = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]

analysis = Analysis(
    [str(ROOT / "macos_app.py")],
    pathex=[str(ROOT)],
    datas=[(str(ROOT / "templates"), "templates"), (str(ROOT / "static"), "static")],
    hiddenimports=["engineio.async_drivers.threading"],
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name=NAME, console=False)
collected = COLLECT(exe, analysis.binaries, analysis.datas, name=NAME)
app = BUNDLE(
    collected,
    name=f"{NAME}.app",
    icon=str(ROOT / "build" / "macos" / "icon.icns"),
    bundle_identifier="com.joshuaswanson.ssh-gui",
    version=VERSION,
    info_plist={
        "CFBundleShortVersionString": VERSION,
        "LSApplicationCategoryType": "public.app-category.developer-tools",
        "NSHighResolutionCapable": True,
        "NSLocalNetworkUsageDescription": "SSH GUI connects to the servers you choose on your local network.",
    },
)
