# -*- coding: utf-8 -*-
"""Build the compact, browser-ready data bundle for the city picker.

Sources:
  - data/china-provinces.json + data/provinces/*.json : Aliyun DataV GeoAtlas
  - data/taiwan-counties.geojson : taiwan-atlas (converted from TopoJSON)

The output is deliberately a plain JS file so the page works from file://
without a local web server (fetch() of local JSON is blocked by browsers).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "provinces"

MUNICIPALITIES = {"110000", "120000", "310000", "500000"}
SARS = {"810000", "820000"}
TAIWAN = "710000"

# Taiwan county/city codes -> simplified Chinese display names.
TAIWAN_NAMES = {
    "09007": "连江县",
    "09020": "金门县",
    "10002": "宜兰县",
    "10004": "新竹县",
    "10005": "苗栗县",
    "10007": "彰化县",
    "10008": "南投县",
    "10009": "云林县",
    "10010": "嘉义县",
    "10013": "屏东县",
    "10014": "台东县",
    "10015": "花莲县",
    "10016": "澎湖县",
    "10017": "基隆市",
    "10018": "新竹市",
    "10020": "嘉义市",
    "63000": "台北市",
    "64000": "高雄市",
    "65000": "新北市",
    "66000": "台中市",
    "67000": "台南市",
    "68000": "桃园市",
}
# Kinmen / Matsu are administered offshore from the Taiwan main island and are
# not part of the DataV Taiwan outline. Keep the national and province views
# geometrically consistent by leaving them out of this picker.
TAIWAN_EXCLUDE = {"09007", "09020"}

ETHNIC_TERMS = [
    "维吾尔", "壮族", "回族", "藏族", "蒙古族", "土家族", "苗族", "彝族",
    "布依族", "侗族", "哈尼族", "傣族", "景颇族", "傈僳族", "白族", "羌族",
    "朝鲜族", "哈萨克", "柯尔克孜", "蒙古", "满族", "瑶族", "畲族",
]


def province_short(name: str) -> str:
    for suffix in ("维吾尔自治区", "壮族自治区", "回族自治区", "自治区",
                   "特别行政区", "省", "市"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def short_name(name: str) -> str:
    """A compact label for the map (e.g. 恩施土家族苗族自治州 -> 恩施)."""
    n = name
    for suffix in ("特别行政区", "维吾尔自治区", "壮族自治区", "回族自治区",
                   "自治区", "省", "市", "地区", "盟"):
        if n.endswith(suffix):
            n = n[: -len(suffix)]
            break
    if n.endswith("自治州"):
        n = n[: -len("自治州")]
    for term in ETHNIC_TERMS:
        n = n.replace(term, "")
    n = n.replace("自治", "")
    if n == "海南" and "自治州" in name:
        n = "海南州"
    return n


def unit_type(name: str) -> str:
    if name.endswith("自治州"):
        return "自治州"
    if name.endswith("地区"):
        return "地区"
    if name.endswith("盟"):
        return "盟"
    return "地级市"


def is_prefecture(props: dict) -> bool:
    """True for the 333 prefecture-level divisions (not direct-administered
    county-level units such as 济源, 仙桃, 五指山 or 石河子)."""
    code = str(props.get("adcode", ""))
    return code.endswith("00") or int(props.get("childrenNum") or 0) > 0


def round_coords(value, ndigits: int = 4):
    if isinstance(value, float):
        return round(value, ndigits)
    if isinstance(value, list):
        return [round_coords(v, ndigits) for v in value]
    if isinstance(value, dict):
        return {k: round_coords(v, ndigits) for k, v in value.items()}
    return value


def feature_center(feature: dict) -> list[float]:
    props = feature.get("properties", {})
    if props.get("center"):
        return [round(float(props["center"][0]), 4), round(float(props["center"][1]), 4)]
    geom = shape(feature["geometry"])
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    point = geom.centroid
    if not geom.contains(point):
        point = geom.representative_point()
    return [round(point.x, 4), round(point.y, 4)]


def slim_feature(feature: dict, props: dict) -> dict:
    return {
        "type": "Feature",
        "properties": props,
        "geometry": round_coords(feature["geometry"]),
    }


def main() -> None:
    provinces_raw = json.loads((DATA / "china-provinces.json").read_text(encoding="utf-8"))
    province_features = [
        f for f in provinces_raw["features"]
        if f.get("properties", {}).get("name")
    ]
    province_features.sort(key=lambda f: int(f["properties"]["adcode"]))

    province_lookup = {
        str(f["properties"]["adcode"]): f for f in province_features
    }

    national_features = []
    province_meta = {}
    province_cities = {}
    city_index = []

    for pcode, pfeature in province_lookup.items():
        pprops = pfeature["properties"]
        pname = pprops["name"]
        pshort = province_short(pname)
        pcenter = feature_center(pfeature)
        pkind = "province"

        if pcode in MUNICIPALITIES:
            pkind = "municipality"
        elif pcode in SARS:
            pkind = "sar"
        elif pcode == TAIWAN:
            pkind = "taiwan"

        # ---- build the map used when this province is opened ----
        if pcode in MUNICIPALITIES or pcode in SARS:
            city_name = pname
            ctype = "直辖市" if pcode in MUNICIPALITIES else "特别行政区"
            cshort = pshort
            city_id = pcode
            city = {
                "id": city_id,
                "adcode": pcode,
                "name": city_name,
                "shortName": cshort,
                "province": pname,
                "provinceShort": pshort,
                "provinceCode": pcode,
                "center": pcenter,
                "type": ctype,
            }
            city_index.append(city)
            province_cities[pcode] = {
                "type": "FeatureCollection",
                "features": [slim_feature(pfeature, {
                    "name": city_name,
                    "adcode": pcode,
                    "shortName": cshort,
                    "center": pcenter,
                    "selectable": True,
                    "type": ctype,
                })],
            }
            city_count = 1

        elif pcode == TAIWAN:
            tw = json.loads((DATA / "taiwan-counties.geojson").read_text(encoding="utf-8"))
            features = []
            for f in tw["features"]:
                tcode = f["properties"]["COUNTYCODE"]
                if tcode in TAIWAN_EXCLUDE:
                    continue
                name = TAIWAN_NAMES.get(tcode)
                if not name:
                    continue
                center = feature_center(f)
                sname = short_name(name)
                if name.endswith("市") or name.endswith("县"):
                    sname = name[:-1]
                # Disambiguate 新竹市/新竹县 and 嘉义市/嘉义县 on the map.
                same_base = [n for n in TAIWAN_NAMES.values()
                             if n[:-1] == sname and n != name]
                if same_base:
                    sname = name
                ctype = "县市"
                city_id = f"TW-{tcode}"
                city = {
                    "id": city_id,
                    "adcode": tcode,
                    "name": name,
                    "shortName": sname,
                    "province": pname,
                    "provinceShort": pshort,
                    "provinceCode": pcode,
                    "center": center,
                    "type": ctype,
                }
                city_index.append(city)
                features.append(slim_feature(f, {
                    "name": name,
                    "adcode": city_id,
                    "shortName": sname,
                    "center": center,
                    "selectable": True,
                    "type": ctype,
                }))
            features.sort(key=lambda f: f["properties"]["adcode"])
            province_cities[pcode] = {"type": "FeatureCollection", "features": features}
            city_count = len(features)

        else:
            raw = json.loads((RAW / f"{pcode}.json").read_text(encoding="utf-8"))
            features = []
            city_count = 0
            for f in raw["features"]:
                props = f["properties"]
                name = props["name"]
                selectable = is_prefecture(props)
                ctype = unit_type(name)
                sname = short_name(name)
                center = feature_center(f)
                if selectable:
                    city_count += 1
                    city_index.append({
                        "id": str(props["adcode"]),
                        "adcode": str(props["adcode"]),
                        "name": name,
                        "shortName": sname,
                        "province": pname,
                        "provinceShort": pshort,
                        "provinceCode": pcode,
                        "center": center,
                        "type": ctype,
                    })
                features.append(slim_feature(f, {
                    "name": name,
                    "adcode": str(props["adcode"]),
                    "shortName": sname,
                    "center": center,
                    "selectable": selectable,
                    "type": ctype if selectable else "县级行政区",
                }))
            province_cities[pcode] = {"type": "FeatureCollection", "features": features}

        province_meta[pcode] = {
            "code": pcode,
            "name": pname,
            "shortName": pshort,
            "center": pcenter,
            "kind": pkind,
            "cityCount": city_count,
        }
        national_features.append(slim_feature(pfeature, {
            "name": pname,
            "adcode": pcode,
            "shortName": pshort,
            "center": pcenter,
            "cityCount": city_count,
            "kind": pkind,
        }))

    # A stable, readable order for search and the random pool.
    city_index.sort(key=lambda c: (int(c["provinceCode"]), str(c["adcode"])))

    national = {
        "type": "FeatureCollection",
        "features": national_features,
    }

    data = {
        "counts": {
            "places": len(city_index),
            "provinces": len(province_meta),
        },
        "provinces": national,
        "provinceMeta": province_meta,
        "provinceCities": province_cities,
        "cities": city_index,
    }

    out = DATA / "app-data.js"
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    out.write_text("window.APP_DATA=" + payload + ";\n", encoding="utf-8")

    print(f"places: {len(city_index)}")
    print(f"provinces: {len(province_meta)}")
    print(f"output: {out} ({out.stat().st_size / 1e6:.2f} MB)")
    for code, meta in province_meta.items():
        if meta["kind"] in ("municipality", "sar", "taiwan"):
            print(f"  {code} {meta['name']}: {meta['cityCount']}")


if __name__ == "__main__":
    main()
