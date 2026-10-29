// 從 Steam 庫存資料抓出每件物品的細節：磨損等級、磨損值、圖案編號、StatTrak™／紀念品、稀有度、貼紙、吊飾、命名牌。
// 網站（書籤、剪貼簿）和中繼站（relay/relay.mjs）共用這支，存成精簡欄位：
//   w 磨損等級、f 磨損值、p 圖案編號、q 品質（"st" StatTrak™、"sv" 紀念品）、rc 稀有度顏色、
//   s 貼紙名稱陣列、k 吊飾名稱陣列、t 命名牌
(function (root) {
  const WEAR_FROM_NAME = {
    // 跟 Steam 繁體中文用的名稱一樣
    "Factory New": "全新出廠",
    "Minimal Wear": "輕微磨損",
    "Field-Tested": "戰場實測",
    "Well-Worn": "重度磨損",
    "Battle-Scarred": "戰痕累累"
  };

  function stripHtml(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .trim();
  }

  // 「貼紙：A, B」→ ["A", "B"]
  function listAfterLabel(html) {
    const text = stripHtml(html).split("\n").map((line) => line.trim()).filter(Boolean).pop() || "";
    const colon = Math.max(text.lastIndexOf(":"), text.lastIndexOf("："));
    const body = colon >= 0 ? text.slice(colon + 1) : text;
    return body.split(/,|，/).map((part) => part.trim()).filter(Boolean).slice(0, 6).map((part) => part.slice(0, 80));
  }

  function nameTagFrom(html) {
    const text = stripHtml(html);
    const quoted = /''(.+)''|「(.+)」|"(.+)"/.exec(text);
    if (quoted) return (quoted[1] || quoted[2] || quoted[3]).slice(0, 40);
    const colon = Math.max(text.lastIndexOf(":"), text.lastIndexOf("："));
    return (colon >= 0 ? text.slice(colon + 1) : text).trim().slice(0, 40);
  }

  function propertyValue(property) {
    for (const key of ["float_value", "int_value", "string_value", "value"]) {
      if (property[key] !== undefined && property[key] !== null && property[key] !== "") return property[key];
    }
    return null;
  }

  // assetProperties：Steam 回傳的 asset_properties 裡，這個 assetid 的那一組
  function extract(description, assetProperties, marketHashName) {
    const details = {};
    const tags = Array.isArray(description?.tags) ? description.tags : [];
    const tag = (category) => tags.find((entry) => String(entry.category || "").toLowerCase() === category);

    const exterior = tag("exterior");
    const wearMatch = /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/.exec(marketHashName || "");
    const wear = exterior?.localized_tag_name || exterior?.name || (wearMatch ? WEAR_FROM_NAME[wearMatch[1]] : "");
    if (wear) details.w = String(wear).slice(0, 20);

    const quality = tag("quality");
    const qualityId = String(quality?.internal_name || "").toLowerCase();
    if (qualityId === "strange" || /StatTrak™/.test(marketHashName || "")) details.q = "st";
    else if (qualityId === "tournament" || /^Souvenir /.test(marketHashName || "")) details.q = "sv";

    const rarity = tag("rarity");
    if (rarity?.color && /^[0-9a-fA-F]{6}$/.test(rarity.color)) details.rc = rarity.color.toLowerCase();

    for (const property of Array.isArray(assetProperties) ? assetProperties : []) {
      const id = Number(property.propertyid);
      const label = String(property.name || "").toLowerCase();
      const value = propertyValue(property);
      if (value === null) continue;
      if (id === 2 || /wear|float/.test(label)) {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0 && number <= 1) details.f = Math.round(number * 1e8) / 1e8;
      } else if (id === 1 || /pattern|seed|template/.test(label)) {
        const number = Number.parseInt(value, 10);
        if (Number.isFinite(number) && number >= 0) details.p = number;
      }
    }

    for (const entry of Array.isArray(description?.descriptions) ? description.descriptions : []) {
      const name = String(entry.name || "").toLowerCase();
      const value = String(entry.value || "");
      if (name === "sticker_info" || (!name && /sticker_info/.test(value))) {
        const stickers = listAfterLabel(value);
        if (stickers.length) details.s = stickers;
      } else if (name === "keychain_info" || (!name && /keychain_info/.test(value))) {
        const charms = listAfterLabel(value);
        if (charms.length) details.k = charms;
      } else if (name === "nametag") {
        const tagName = nameTagFrom(value);
        if (tagName) details.t = tagName;
      }
    }
    if (!details.t && Array.isArray(description?.fraudwarnings)) {
      const warning = description.fraudwarnings.find((line) => /''/.test(String(line)));
      if (warning) details.t = nameTagFrom(warning);
    }
    return details;
  }

  // asset_properties 陣列 → Map(assetid → 那件物品的屬性)
  function propertiesByAsset(list) {
    const map = new Map();
    for (const entry of Array.isArray(list) ? list : []) {
      if (entry && entry.assetid) map.set(String(entry.assetid), entry.asset_properties || entry.properties || []);
    }
    return map;
  }

  // 給畫面用的文字，例如「戰場實測 · 0.165214 · 圖案 134」
  function summary(details) {
    if (!details) return "";
    const parts = [];
    if (details.q === "st") parts.push("StatTrak™");
    if (details.q === "sv") parts.push("紀念品");
    if (details.w) parts.push(details.w);
    if (Number.isFinite(details.f)) parts.push(details.f.toFixed(6));
    if (Number.isFinite(details.p)) parts.push(`圖案 ${details.p}`);
    return parts.join(" · ");
  }

  function extras(details) {
    if (!details) return [];
    const lines = [];
    if (details.s?.length) lines.push(`貼紙：${details.s.join("、")}`);
    if (details.k?.length) lines.push(`吊飾：${details.k.join("、")}`);
    if (details.t) lines.push(`命名牌：${details.t}`);
    return lines;
  }

  // 只留下有值的欄位，方便存進 Firestore
  function pick(source) {
    const details = {};
    for (const key of ["w", "f", "p", "q", "rc", "s", "k", "t"]) {
      if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") details[key] = source[key];
    }
    return details;
  }

  const api = { extract, propertiesByAsset, summary, extras, pick };
  root.eloItemDetails = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
