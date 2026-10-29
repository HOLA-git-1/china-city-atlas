import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Directory, Filesystem } from "@capacitor/filesystem";

/**
 * Thin bridge used by the web app when it runs inside the Capacitor shell.
 * On the web this object is present but `available` is false, so app.js
 * keeps using the Web Share API or a plain download.
 */
async function shareDataUrl(dataUrl, fileName, text) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Native share is only available inside the app shell.");
  }

  const base64 = String(dataUrl).split(",")[1];
  if (!base64) throw new Error("Empty image data.");

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  });

  await Share.share({
    title: "中国城市漫游",
    text,
    files: [uri],
    dialogTitle: "分享这座城市",
  });
}

if (Capacitor.isNativePlatform()) {
  // Android's back button closes overlays and leaves a province view before
  // it closes the app. app.js decides what "handled" means.
  App.addListener("backButton", () => {
    const handled =
      typeof window.handleNativeBack === "function" && window.handleNativeBack();
    if (!handled) App.exitApp();
  });
}

window.NativeShare = {
  available: Capacitor.isNativePlatform(),
  shareDataUrl,
};
