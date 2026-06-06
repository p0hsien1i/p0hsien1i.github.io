export interface NavLink {
  label: string;
  href: string;
}

export const site = {
  name: "阿波的三角飯糰",
  nameEn: "Apo's Onigiri",
  tagline:
    "這裡是阿波的隨筆天地 — 吃喝玩樂、投資與抒發心情的地方,歡迎隨意逛逛。",
  author: "李柏憲 Brian Li",
  authorAka: "飯糰編",
  email: "pohsienbrianli@gmail.com",
  roles: ["藥師", "定量藥理", "業餘交易"],
  social: {
    linkedin: "https://www.linkedin.com/in/phbrianli/",
    shopee: "https://shopee.tw/brianlee0001",
  },
};

// Home single-page anchors + blog link
export const navLinks: NavLink[] = [
  { label: "關於", href: "/#about" },
  { label: "部落格", href: "/blog" },
  { label: "藥師 Murmur", href: "/#pharmacist" },
  { label: "投資", href: "/#invest" },
  { label: "影音", href: "/#videos" },
  { label: "配音", href: "/#voice" },
  { label: "聯絡", href: "/#connect" },
];
