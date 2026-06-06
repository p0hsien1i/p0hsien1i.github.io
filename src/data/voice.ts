export interface VoiceClip {
  title: string;
  src: string;
  image?: string;
}

// Joe Huang 配音作品 (audio served from public/audio/)
export const voiceClips: VoiceClip[] = [
  { title: "無參考音配音 — 海綿寶寶 派大星", src: "/audio/spongebob-patrick.wav" },
  { title: "無參考音配音 — 海綿寶寶 珊迪", src: "/audio/spongebob-sandy.wav" },
  { title: "廣播劇配音", src: "/audio/radio-drama.mp3" },
  { title: "海鷗 Sammy", src: "/audio/seagull-sammy.mp3", image: "/audio/seagull.png" },
  { title: "Pecker", src: "/audio/pecker.mp3", image: "/audio/pecker.png" },
  { title: "Eddy the Crazy", src: "/audio/eddy.mp3", image: "/audio/eddy.png" },
];
