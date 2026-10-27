// 讀取 GitHub Actions 定時更新的 prices.json（Skinport 參考價，美元），換算成台幣與 EC。
// 檔案約 1 MB，只在需要價格的功能第一次使用時才載入。
window.eloPrices = (() => {
  const TWD_PER_EC = 0.03;
  let data = null;
  let loading = null;

  function load() {
    if (!loading) {
      const hourKey = new Date().toISOString().slice(0, 13);
      loading = fetch(`prices.json?h=${hourKey}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          if (json && json.prices && Number(json.usdToTwd) > 0) {
            data = json;
            window.dispatchEvent(new Event("elopricesloaded"));
          }
          return data;
        })
        .catch((error) => {
          console.warn("Prices unavailable:", error);
          loading = null;
          return null;
        });
    }
    return loading;
  }

  function twd(marketHashName) {
    const usd = Number(data?.prices?.[marketHashName]);
    if (!Number.isFinite(usd) || usd <= 0) return null;
    return Math.round(usd * data.usdToTwd * 100) / 100;
  }

  function ec(marketHashName) {
    const value = twd(marketHashName);
    return value === null ? null : Math.max(1, Math.round(value / TWD_PER_EC));
  }

  function updatedLabel() {
    if (!data?.updatedAt) return "";
    return new Date(data.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  return { load, twd, ec, loaded: () => Boolean(data), updatedLabel };
})();
