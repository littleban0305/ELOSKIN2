// Steam 庫存匯入共用工具：解析貼上的庫存 JSON（內容被截斷時盡量救回）、產生書籤小工具、接收書籤帶回來的資料。
window.eloInventoryImport = (() => {
  const ICON_BASE = "https://community.cloudflare.steamstatic.com/economy/image/";
  const SITE_URL = "https://littleban0305.github.io/ELOSKIN2/";
  // 舊書籤帶回 trade-import，新書籤帶回 profile-import，兩個都交給個人頁處理
  const HASH_KEYS = { "trade-import": "profile", "profile-import": "profile", "admin-import": "admin" };
  const HASH_PAGES = { "trade-import": "trade", "profile-import": "profile", "admin-import": "admin" };

  function iconUrl(icon) {
    return typeof icon === "string" && icon ? ICON_BASE + icon.split("/").map(encodeURIComponent).join("/") : "";
  }

  const itemDetails = window.eloItemDetails;

  function toItems(assets, descriptions, assetProperties = [], steamId = "") {
    const byKey = new Map(descriptions.map((description) => [`${description.classid}_${description.instanceid}`, description]));
    const properties = itemDetails.propertiesByAsset(assetProperties);
    const items = [];
    for (const asset of assets) {
      const description = byKey.get(`${asset.classid}_${asset.instanceid}`);
      if (!description || Number(description.tradable) !== 1) continue;
      const marketHashName = String(description.market_hash_name || description.name || "");
      items.push({
        assetId: String(asset.assetid),
        amount: Math.max(1, Number.parseInt(asset.amount, 10) || 1),
        name: String(description.name || description.market_hash_name || "CS2"),
        marketHashName,
        type: String(description.type || ""),
        iconUrl: iconUrl(description.icon_url),
        details: itemDetails.pick(itemDetails.extract(description, properties.get(String(asset.assetid)), marketHashName, { assetId: String(asset.assetid), steamId }))
      });
    }
    return items;
  }

  // 從 start 開始掃描，取出陣列裡每個完整的 {...} 物件；遇到被截斷的就停下
  function completeObjects(text, start) {
    const objects = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectStart = -1;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") inString = true;
      else if (character === "{") {
        if (depth === 0) objectStart = index;
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0 && objectStart >= 0) {
          try {
            objects.push(JSON.parse(text.slice(objectStart, index + 1)));
          } catch {
            // 單一物件壞掉就略過
          }
          objectStart = -1;
        }
      } else if (character === "]" && depth === 0) break;
    }
    return objects;
  }

  function salvage(text) {
    const assetsAt = text.indexOf("\"assets\":[");
    const descriptionsAt = text.indexOf("\"descriptions\":[");
    if (assetsAt < 0 || descriptionsAt < 0) return null;
    const assets = completeObjects(text, assetsAt + 10);
    const descriptions = completeObjects(text, descriptionsAt + 16);
    if (!assets.length || !descriptions.length) return null;
    const propertiesAt = text.indexOf("\"asset_properties\":[");
    const assetProperties = propertiesAt >= 0 ? completeObjects(text, propertiesAt + 20) : [];
    return { assets, descriptions, asset_properties: assetProperties };
  }

  function parse(raw, text, steamId = "") {
    const source = String(raw || "");
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0) throw new Error(text("admin.pasteInvalid"));
    let data = null;
    let truncated = false;
    try {
      const parsed = JSON.parse(source.slice(start, end + 1));
      if (parsed === null || parsed?.success === false) throw new Error(text("admin.pastePrivate"));
      data = parsed?.response && typeof parsed.response === "object" ? parsed.response : parsed;
      if (!Array.isArray(data?.assets) || !Array.isArray(data?.descriptions)) throw new Error(text("admin.pasteInvalid"));
      truncated = Number(data.more_items) === 1 || data.more_items === true;
    } catch (error) {
      if (error.message === text("admin.pastePrivate")) throw error;
      data = salvage(source.slice(start));
      if (!data) throw new Error(text("admin.pasteInvalid"));
      truncated = true;
    }
    return { items: toItems(data.assets, data.descriptions, data.asset_properties || [], steamId), truncated };
  }

  // 書籤小工具：在 steamcommunity.com 上執行，讀完庫存後帶著精簡資料跳回 ELOSKIN2
  function bookmarklet(steamId, target) {
    const code = `(async()=>{const S=${JSON.stringify(String(steamId))},T=${JSON.stringify(target)},U=${JSON.stringify(SITE_URL)};`
      + `if(location.hostname!=='steamcommunity.com'){alert('請先打開 Steam 社群網站（steamcommunity.com）再使用');location.href='https://steamcommunity.com/';return}`
      + `try{const r=await fetch('/inventory/'+S+'/730/2?l=tchinese&count=2000',{credentials:'include'});const d=await r.json();`
      + `if(!d||!d.assets){alert('讀不到庫存，請確認 Steam 物品庫是公開的');return}`
      + `const m={},P={};d.descriptions.forEach(x=>m[x.classid+'_'+x.instanceid]=x);(d.asset_properties||[]).forEach(p=>P[p.assetid]=(p.asset_properties||[]).filter(q=>q.propertyid==1||q.propertyid==2||q.propertyid==6));const i=[];`
      + `const C=['exterior','quality','rarity'],N=['sticker_info','keychain_info','nametag'],H=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim();`
      + `d.assets.forEach(a=>{const x=m[a.classid+'_'+a.instanceid];if(x&&x.tradable==1)i.push([a.assetid,x.name,x.market_hash_name,x.type,x.icon_url,`
      + `(x.tags||[]).filter(t=>C.includes(String(t.category).toLowerCase())).map(t=>[t.category,t.internal_name,t.localized_tag_name,t.color||'']),`
      + `(x.descriptions||[]).filter(e=>N.includes(e.name)).map(e=>[e.name,H(e.value)]),P[a.assetid]||[],((x.actions||[])[0]||{}).link||''])});`
      + `location.href=U+'#'+T+'-import='+encodeURIComponent(JSON.stringify({s:S,i}))}catch(e){alert('讀取失敗：'+e.message)}})()`;
    return `javascript:${code}`;
  }

  // 網站載入時檢查網址是不是書籤帶回來的資料；有的話取出並把網址改回正常頁面
  function takeHashImport() {
    const match = /^#(trade-import|profile-import|admin-import)=(.+)$/.exec(window.location.hash);
    if (!match) return null;
    const page = HASH_KEYS[match[1]];
    window.history.replaceState(window.history.state, "", `#${HASH_PAGES[match[1]]}`);
    try {
      const payload = JSON.parse(decodeURIComponent(match[2]));
      if (!Array.isArray(payload?.i)) return null;
      const items = payload.i
        .filter((row) => Array.isArray(row) && row.length >= 5)
        .map(([assetId, name, marketHashName, type, icon, tags, descriptions, properties, inspect]) => {
          const description = {
            actions: inspect ? [{ link: String(inspect) }] : [],
            tags: (Array.isArray(tags) ? tags : []).map(([category, internal_name, localized_tag_name, color]) => ({ category, internal_name, localized_tag_name, color })),
            descriptions: (Array.isArray(descriptions) ? descriptions : []).map(([entryName, value]) => ({ name: entryName, value }))
          };
          const hashName = String(marketHashName || name || "");
          return {
            assetId: String(assetId),
            amount: 1,
            name: String(name || marketHashName || "CS2"),
            marketHashName: hashName,
            type: String(type || ""),
            iconUrl: iconUrl(icon),
            details: itemDetails.pick(itemDetails.extract(description, Array.isArray(properties) ? properties : [], hashName, { assetId: String(assetId), steamId: String(payload.s || "") }))
          };
        });
      return { target: page, steamId: String(payload.s || ""), items };
    } catch {
      return null;
    }
  }

  const pending = takeHashImport();

  // 綁定「ELOSKIN 讀取庫存」按鈕與「複製書籤程式碼」
  function bindBookmarklet({ link, copyButton, status, text }) {
    let code = "";
    const setStatus = (key, kind) => {
      status.textContent = key ? text(key) : "";
      status.dataset.kind = kind || "";
    };
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setStatus("inventory.dragHint", "info");
    });
    copyButton.addEventListener("click", async () => {
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        setStatus("inventory.copied", "success");
      } catch {
        const area = document.createElement("textarea");
        area.value = code;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        setStatus(ok ? "inventory.copied" : "inventory.copyFailed", ok ? "success" : "error");
      }
    });
    return (steamId, target) => {
      code = steamId ? bookmarklet(steamId, target) : "";
      if (code) link.setAttribute("href", code);
      else link.removeAttribute("href");
      copyButton.disabled = !code;
    };
  }

  return {
    parse,
    bookmarklet,
    bindBookmarklet,
    pending: (target) => (pending && pending.target === target ? pending : null),
    clearPending: (target) => {
      if (pending && pending.target === target) pending.target = "";
    }
  };
})();
