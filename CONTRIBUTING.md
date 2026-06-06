# 怎麼更新「阿波的三角飯糰」

網站用 [Astro](https://astro.build) 做,放在 GitHub。**你只要改檔案 → commit/push,GitHub Actions 會自動重新建置上線(約 1–2 分鐘)**,不用在本機跑任何指令。最簡單的方式:直接在 github.com 網頁上編輯。

## 新增一篇文章

在 `src/content/blog/` 新增一個 `.md`(或 `.mdx`)檔,檔名建議 `YYYY-MM-DD-英文簡稱.md`,例如 `2026-06-10-my-post.md`。

最上面放 frontmatter(用 `---` 包起來):

```md
---
title: 文章標題
description: 一句話摘要(會出現在卡片與搜尋結果)
pubDate: 2026-06-10
category: essay        # food 食記 / movie 影評 / essay 心得 / journal 隨筆 / stock 投資
tags: [標籤1, 標籤2]
authors: ["Brian Li (飯糰編)"]
---

這裡開始寫正文,用 Markdown。

**粗體**、[連結](https://...)、清單都可以。
```

寫好 commit → 推上去 → 自動上線,文章會自動出現在 `/blog` 和首頁最新文章。

## 常用語法

- **圖片**:把圖放進 `src/assets/blog/你的文章slug/`,文中用 `![說明](../../assets/blog/你的文章slug/圖檔.jpg)`,建置時會自動壓縮成 webp。
- **YouTube**(只在 `.mdx` 檔可用):`<YouTubeEmbed id="影片ID" title="說明" />`
- **食記評分**(category 設 `food`)額外加:
  ```yaml
  foodReview:
    location: 店名
    address: 地址(可省略)
    mapEmbed: "Google Maps 嵌入 iframe 的 src 網址"(可省略)
    ratings: { transport: 5, ambience: 5, service: 5, taste: 4.5, price: 5 }  # 0~5
  ```
- **草稿**:frontmatter 加 `draft: true`,就不會公開顯示。

## 本機預覽(選用,需要在效能機)

```
cd C:\dev\apo-onigiri
npm run dev      # 開 http://localhost:4321 即時預覽
npm run build    # 正式建置(發佈前會自動跑)
```

## 之後要接自訂網域(例如 aposworld.com)

在 `public/` 加一個 `CNAME` 檔(內容只寫網域),到網域商設定 DNS,再到 repo Settings → Pages 開啟 Enforce HTTPS。需要時再找我。
