# 中国城市漫游 · China City Atlas

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
- **三沙**：海南视图默认聚焦本岛，底部「三沙市 · 南海诸岛 →」可跳转到南海诸岛视图并选中三沙市。
- **响应式**：桌面双栏、移动端单栏布局。

## 数据范围

- **359 个地点** = 333 个地级行政区 + 4 个直辖市 + 2 个特别行政区 + 20 个台湾县市。
- 只抽取**地级及以上**：省直辖县级单位（济源、仙桃、五指山、石河子等）仍会显示在省图上，但以弱化样式呈现且不参与随机、不可选中。
- 台湾县市类型标注为「县市」；金门、马祖不在 DataV 的台湾轮廓内，为保证全国图与省图几何一致，未纳入。
- 直辖市与特别行政区各自视为一个地点。

## 目录结构

```
index.html              页面结构
styles.css              纸墨朱砂视觉系统与响应式布局
app.js                  地图渲染、抽取、搜索、历史记录等逻辑
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
