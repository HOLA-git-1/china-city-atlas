# 中国城市漫游 · China City Atlas

在线访问：<https://HOLA-git-1.github.io/china-city-atlas/>

一个完全离线的单页网页：从全国 **359 个市级地点**中随机抽取，也可以在地图上自由点选，并在地图上标出当前位置。

## 打开方式

直接双击 `index.html` 即可。页面通过 `<script>` 载入数据，不依赖本地服务器，断网也能用。

推荐使用较新的 Chrome / Edge / Safari。

## 功能

- **随机抽取**：全国 359 个地点随机一抽，带滚轮/揭幕动画；结果同步到地图与右侧面板。
- **本省随机**：进入任一省份后，只在该省内抽取。
- **地图浏览**：全国 → 省份逐层进入；点击城市即选中；滚轮缩放，`+ / − / ◎` 控制缩放与重置。
- **搜索**：输入城市名或省份名，`↑ ↓` 选择、`Enter` 确认、`Esc` 关闭。
- **最近到访**：最近 6 个目的地保存在 `localStorage`，点击可快速回到。
- **我的行囊**：把城市标记为「想去」或「去过」，在侧栏分栏查看、点击回到，记录保存在 `localStorage`。
- **分享卡片**：为当前城市生成一张 1080×1440 的分享图，包含省份轮廓、城市名、坐标和日期；网页端可下载或用系统分享，App 内调用原生分享面板。
- **三沙**：海南视图默认聚焦本岛，底部「三沙市 · 南海诸岛 →」可跳转到南海诸岛视图并选中三沙市。
- **响应式**：桌面双栏、移动端单栏布局；App 内适配刘海屏安全区。

## 数据范围

- **359 个地点** = 333 个地级行政区 + 4 个直辖市 + 2 个特别行政区 + 20 个台湾县市。
- 只抽取**地级及以上**：省直辖县级单位（济源、仙桃、五指山、石河子等）仍会显示在省图上，但以弱化样式呈现且不参与随机、不可选中。
- 台湾县市类型标注为「县市」；金门、马祖不在 DataV 的台湾轮廓内，为保证全国图与省图几何一致，未纳入。
- 直辖市与特别行政区各自视为一个地点。

## 目录结构

```
index.html              页面结构
styles.css              纸墨朱砂视觉系统与响应式布局
app.js                  地图渲染、抽取、搜索、收藏、分享等逻辑
native-share.js         Capacitor 原生分享桥（esbuild 产物，已提交）
native/
  share.js              原生分享桥源码
assets/
  og-cover.png          社交分享封面（1200×630）
data/
  app-data.js           生成的数据包（window.APP_DATA，约 3.7 MB）
  china-provinces.json  全国省级边界（DataV 原始文件）
  provinces/*.json      各省市级边界（DataV 原始文件）
  taiwan-province.json  全国图使用的台湾省轮廓
  taiwan-counties.geojson  台湾县市边界（用于重新生成数据）
lib/
  echarts.min.js        ECharts 5.6.0
tools/
  build_data.py         数据打包脚本
  prepare-www.mjs       为 Capacitor 准备精简的 www/ 目录
  generate_android_icons.py  生成启动图标与启动屏
android/                Capacitor 生成的 Android 工程
capacitor.config.json   App 包名、名称、webDir
package.json            Capacitor / 原生分享依赖与构建脚本
.github/workflows/android.yml  云端构建 debug APK
robots.txt              允许搜索引擎抓取
LICENSE                 MIT
tmp/                    开发期测试脚本与截图（未纳入版本库）
```

## 重新生成数据

```
pip install shapely
python tools/build_data.py
```

脚本会读取 `data/china-provinces.json`、`data/provinces/*.json` 和 `data/taiwan-counties.geojson`，
输出 `data/app-data.js`，并打印地点数、省份数等统计。
`data/taiwan-counties.geojson` 由 taiwan-atlas 的 TopoJSON 经 `topojson-client` 转换而来。

## 部署到 GitHub Pages

仓库使用 GitHub Pages 的 **Deploy from a branch** 方式：分支 `main`、目录 `/ (root)`，推送到 `main` 后自动构建。

也可以在 Settings → Pages 里开启，或使用发布脚本 `tools/publish_github.py`。脚本只访问 `api.github.com`，因此在 `github.com` 直连不稳定的网络里也能用：

1. 创建一个 classic token（勾选 `public_repo`）：  
   https://github.com/settings/tokens/new?scopes=public_repo&description=china-city-atlas
2. 在项目目录运行：

   ```bat
   python tools\publish_github.py
   ```

3. 按提示粘贴 token（输入时不显示）。脚本会自动创建仓库、以一次提交上传所有文件、开启 GitHub Pages，并输出站点地址；之后重跑即可更新站点。

也可以完全在网页上手动操作：新建空仓库 → 上传全部文件 → Settings → Pages → Source 选 `Deploy from a branch`、分支 `main`、目录 `/ (root)`。

## 打包安卓 App（Capacitor）

网页代码原样复用，Capacitor 只提供原生外壳和分享能力，不重写界面。

```batch
npm install
npm run sync
```

- **云端构建（推荐）**：推送到 `main` 后，GitHub Actions 的 **Build Android APK** 会自动运行；在 Actions 运行页面下载 `china-city-atlas-debug`，解压得到 `app-debug.apk`。
- **本地构建**：安装 Android Studio（含 SDK）后运行 `npm run android`，APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

debug APK 使用调试签名，可直接安装到手机，适合自用和内测。App 内所有页面与数据都是本地文件，断网可用；分享按钮会调起系统分享面板，网页端则使用 Web Share 或直接下载图片。

### 上架商店前的准备

当前产物是内测用 debug APK。若要上架：

- **Google Play**：开发者账号、隐私政策、正式签名；新个人账号还需完成 12 人 × 14 天的封闭测试。
- **国内安卓商店**：通常需要软件著作权、App 备案（绑定已 ICP 备案的域名和境内服务器），以及地图合规材料（审图号/测绘资质）。本项目地图为行政区划示意，发布前请自行评估合规要求。
- **iOS**：需要 macOS 构建环境与 Apple 开发者账号；中国区上架同样涉及 ICP 备案。

## 数据来源与许可

- 中国大陆及港澳行政边界：**阿里云 DataV GeoAtlas**  
  https://datav.aliyun.com/portal/school/atlas/area_selector
- 台湾县市边界：**taiwan-atlas**（依据内政部资料预生成 TopoJSON，MIT）  
  https://github.com/dkaoster/taiwan-atlas
- 地图渲染：**Apache ECharts 5.6.0**（Apache-2.0）

## 开源许可

- 本站代码以 **MIT License** 开源，见 [LICENSE](LICENSE)。
- 第三方资源遵循各自许可：ECharts（Apache-2.0）、taiwan-atlas（MIT）。
- 行政边界数据来自阿里云 DataV GeoAtlas，仅用于地图展示与学习研究；本项目与上述数据提供方无隶属关系。
- 地图边界为制图用途的简化数据，不作为领土主张或行政勘界的依据。

## 已知取舍

- 全国图注册名为 `china` 时，ECharts 会自动附加「南海诸岛」缩略框，并补充钓鱼岛等几何；这是组件内置行为。
- 海南省的行政范围一直延伸到约 4°N，若完整适配会让本岛缩成一个点，因此本岛与南海诸岛分两个视图呈现。
